const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();
const multer = require('multer');
const pool = require('../database');
const sharp = require('sharp');
const Jimp = require("jimp");
const { decode } = require("@zxing/text-encoding");
const XLSX = require('xlsx');
const {isLoggedIn} = require('../lib/auth');

// Configurar multer para almacenar archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ✅ Función CORRECTA para convertir fecha Excel (serial) a YYYY-MM-DD
function excelDateToJSDate(serial) {
    // Excel epoch base: 1899-12-30
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const days = Math.floor(serial);
    const milliseconds = days * 24 * 60 * 60 * 1000;
    const date = new Date(excelEpoch.getTime() + milliseconds);

    // Formato YYYY-MM-DD
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

router.post('/remision/agregar', isLoggedIn, async (req, res) => {
    const idProducto = req.body.id_productos;
    const cantidadSolicitada = parseInt(req.body.cantidad);
    const idOperario = req.user.id_operario;
    console.log(req.user.id_operario);

    try {
        // 1. Obtener los lotes disponibles
        const lotes = await pool.query(`
            SELECT nro_lote, SUM(cantidad) AS cantidad, MIN(fecha_vencimiento) AS fecha_vencimiento
            FROM lotes_productos
            WHERE id_productos = ? 
            GROUP BY nro_lote
            HAVING cantidad > 0
            ORDER BY fecha_vencimiento ASC
        `, [idProducto]);

        let cantidadRestante = cantidadSolicitada;
        const lotesUsados = [];

        for (const lote of lotes) {
            if (cantidadRestante <= 0) break;

            const usarCantidad = Math.min(lote.cantidad, cantidadRestante);
            lotesUsados.push({
                nro_lote: lote.nro_lote,
                cantidad: usarCantidad
            });

            cantidadRestante -= usarCantidad;
        }

        if (cantidadRestante > 0) {
            req.flash('error', '❌ No hay suficiente stock disponible en los lotes.');
            return res.redirect('/products/all');
        }

        // 2. Guardar en el carrito y actualizar inventario
        for (const item of lotesUsados) {
            await pool.query(`
                INSERT INTO carrito_remision (id_productos, id_operario, nro_lote, cantidad) 
                VALUES (?, ?, ?, ?)
            `, [idProducto, idOperario, item.nro_lote, item.cantidad]);

            await pool.query(`
                UPDATE lotes_productos 
                SET cantidad = cantidad - ? 
                WHERE nro_lote = ? AND id_productos = ?
            `, [item.cantidad, item.nro_lote, idProducto]);
        }

        res.redirect('/products/all');
    } catch (err) {
        console.error('❌ Error al agregar a remisión:', err);
        res.status(500).send('Error interno');
    }
});

router.get('/remision/carrito', isLoggedIn, async (req, res) => {
    try {
        const idOperario = req.user.id_operario;

        // Obtiene todos los items del carrito de este operario
        const carrito = await pool.query(`
      SELECT cr.*, p.nombre, p.codigo_barras
      FROM carrito_remision cr
      JOIN productos p ON cr.id_productos = p.id_productos
      WHERE cr.id_operario = ?
    `, [idOperario]);

        res.render('remision_carrito', { carrito });
    } catch (err) {
        console.error('❌ Error al cargar el carrito:', err);
        res.status(500).send('Error interno');
    }
});

router.post('/remision/carrito/eliminar', isLoggedIn, async (req, res) => {
    const id = req.body.id; // este es el id de la tabla carrito_remision
    try {
        // Devuelve la cantidad al lote correspondiente
        const item = await pool.query('SELECT * FROM carrito_remision WHERE id_carrito = ?', [id]);
        if (item.length > 0) {
            await pool.query(`
        UPDATE lotes_productos
        SET cantidad = cantidad + ?
        WHERE nro_lote = ? AND id_productos = ?
      `, [item[0].cantidad, item[0].nro_lote, item[0].id_productos]);

            // Elimina del carrito
            await pool.query('DELETE FROM carrito_remision WHERE id_carrito = ?', [id]);
        }
        res.redirect('/products/all');
    } catch (err) {
        console.error('❌ Error al eliminar item del carrito:', err);
        res.status(500).send('Error interno');
    }
});

router.post('/remision/carrito/confirmar', isLoggedIn, async (req, res) => {
    const idOperario = req.user.id_operario;

    if (!idOperario) {
        return res.status(401).send('⚠️ Debes iniciar sesión');
    }

    try {
        // 0️⃣ Verificar si tiene remisiones pendientes por firmar como recibido
        const pendientes = await pool.query(`
            SELECT id_remision 
            FROM remision 
            WHERE creado_por = ? 
              AND (recibido_por IS NULL OR firma_recibe IS NULL)
        `, [idOperario]);

        if (pendientes.length > 1) {
            req.flash('warning', `⚠️ Tienes ${pendientes.length} remisión(es) pendiente(s) por firmar como recibido. Completa esa(s) firma(s) antes de continuar.`);
            return res.redirect('/products/all');
        }

        // 1️⃣ Traer productos del carrito
        const carrito = await pool.query(
            `SELECT c.*, p.nombre AS nombre_producto, p.codigo_barras
             FROM carrito_remision c
             JOIN productos p ON c.id_productos = p.id_productos
             WHERE c.id_operario = ?`,
            [idOperario]
        );

        if (carrito.length === 0) {
            return res.send('⚠️ No hay productos en el carrito.');
        }

        // 2️⃣ Datos del operario
        const operario = await pool.query(
            'SELECT username FROM operario WHERE id_operario = ?',
            [idOperario]
        );
        const nombreOperario = operario[0]?.username || `Operario ID ${idOperario}`;

        // 3️⃣ Insertar remisión sin firma
        const remisionResult = await pool.query(
            'INSERT INTO remision (creado_por) VALUES (?)',
            [idOperario]
        );
        const idRemision = remisionResult.insertId;

        // 4️⃣ Detalles de productos
        for (const item of carrito) {
            await pool.query(
                `INSERT INTO detalle_remision (id_remision, id_productos, nro_lote, cantidad) 
                 VALUES (?, ?, ?, ?)`,
                [idRemision, item.id_productos, item.nro_lote, item.cantidad]
            );
        }

        // 5️⃣ Vaciar carrito
        await pool.query('DELETE FROM carrito_remision WHERE id_operario = ?', [idOperario]);

        // 6️⃣ Generar PDF (sin firmas)
        const PDFDocument = require('pdfkit');
        const path = require('path');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="remision_${idRemision}.pdf"`);

        const doc = new PDFDocument({ margin: 40 });
        doc.pipe(res);

        doc.image(path.join(__dirname, '../public/img/logo.png'), 40, 40, { width: 80 });

        doc.moveDown(4);
        doc.fontSize(20).text('Remisión de Productos', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Remisión No.: ${idRemision}`);
        doc.text(`Fecha: ${new Date().toLocaleString()}`);
        doc.text(`Operario: ${nombreOperario}`);
        doc.moveDown();
        doc.fontSize(14).text('Detalle de productos:', { underline: true });
        doc.moveDown(0.5);

        const itemX = 40;
        const codigoX = 200;
        const loteX = 320;
        const cantidadX = 450;
        const tableTop = doc.y;

        doc
            .fontSize(12)
            .text('Producto', itemX, tableTop)
            .text('Código', codigoX, tableTop)
            .text('Lote', loteX, tableTop)
            .text('Cantidad', cantidadX, tableTop);
        doc.moveTo(itemX, tableTop + 15).lineTo(550, tableTop + 15).stroke();

        let y = tableTop + 25;
        carrito.forEach((item) => {
            doc
                .fontSize(10)
                .text(item.nombre_producto, itemX, y)
                .text(item.codigo_barras, codigoX, y)
                .text(item.nro_lote, loteX, y)
                .text(item.cantidad.toString(), cantidadX, y);
            y += 20;
        });

        doc.moveTo(itemX, y + 10).lineTo(550, y + 10).stroke();

        const firmaY = y + 30;
        const firma1X = itemX;
        const firma2X = 300;

        doc
            .fontSize(10)
            .text('Entregado por:', firma1X, firmaY)
            .text('____________________________', firma1X, firmaY + 42);

        doc
            .fontSize(10)
            .text('Recibido por:', firma2X, firmaY)
            .text('____________________________', firma2X, firmaY + 42);

        doc.end();

    } catch (err) {
        console.error('❌ Error al confirmar remisión:', err);
        res.status(500).send('Error interno');
    }
});

// Ruta para listar todas las remisiones
router.get('/remision/confirmar', isLoggedIn, async (req, res) => {
    try {
        let remisiones;

        if (req.user.role === 'admin') {
            // Si es admin, ve todas las remisiones
            remisiones = await pool.query(`
                SELECT 
                    r.id_remision, 
                    r.fecha_remision, 
                    r.firma_entrega, 
                    r.firma_recibe, 
                    o.username,
                    oe.username AS entregado_por_nombre,
                    orc.username AS recibido_por_nombre
                FROM remision r
                LEFT JOIN operario o ON r.creado_por = o.id_operario
                LEFT JOIN operario oe ON r.entregado_por = oe.id_operario
                LEFT JOIN operario orc ON r.recibido_por = orc.id_operario
                ORDER BY r.fecha_remision DESC
            `);
        } else {
            // Si es user, ve solo las suyas
            remisiones = await pool.query(`
                SELECT 
                    r.id_remision, 
                    r.fecha_remision, 
                    r.firma_entrega, 
                    r.firma_recibe, 
                    o.username,
                    oe.username AS entregado_por_nombre,
                    orc.username AS recibido_por_nombre
                FROM remision r
                LEFT JOIN operario o ON r.creado_por = o.id_operario
                LEFT JOIN operario oe ON r.entregado_por = oe.id_operario
                LEFT JOIN operario orc ON r.recibido_por = orc.id_operario
                WHERE r.creado_por = ?
                ORDER BY r.fecha_remision DESC
            `, [req.user.id_operario]);
        }

        res.render('products/remision', { remisiones });
    } catch (error) {
        console.error('Error al listar remisiones:', error);
        res.status(500).send('Error al cargar remisiones');
    }
});

router.get('/remision/pdf/:id', isLoggedIn, async (req, res) => {
    const idRemision = req.params.id;

    try {
        const remision = await pool.query(
            `SELECT 
  r.*, 
  o.username AS creado_por_nombre,
  oe.username AS entregado_por_nombre,
  orc.username AS recibido_por_nombre
FROM remision r
LEFT JOIN operario o ON r.creado_por = o.id_operario
LEFT JOIN operario oe ON r.entregado_por = oe.id_operario
LEFT JOIN operario orc ON r.recibido_por = orc.id_operario
WHERE r.id_remision = ?`,
            [idRemision]
        );
        if (!remision.length) return res.status(404).send('Remisión no encontrada');
        const remisionData = remision[0];

        const detalles = await pool.query(
            `SELECT d.*, p.nombre AS nombre_producto, p.codigo_barras
       FROM detalle_remision d
       JOIN productos p ON d.id_productos = p.id_productos
       WHERE d.id_remision = ?`,
            [idRemision]
        );

        const PDFDocument = require('pdfkit');
        const path = require('path');
        const doc = new PDFDocument({ margin: 40 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="remision_${idRemision}.pdf"`);

        doc.pipe(res);

        // Logo
        doc.image(path.join(__dirname, '../public/img/logo.png'), 40, 40, { width: 80 });
        doc.moveDown(4);

        // Encabezado
        doc.fontSize(20).text('Remisión de Productos', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Remisión No.: ${idRemision}`);
        doc.text(`Fecha: ${new Date(remisionData.fecha_remision).toLocaleString()}`);
        doc.text(`Operario: ${remisionData.creado_por_nombre || 'Desconocido'}`);
        doc.moveDown();

        // Detalle productos
        doc.fontSize(14).text('Detalle de productos:', { underline: true });
        doc.moveDown(0.5);

        const itemX = 40, codigoX = 200, loteX = 320, cantidadX = 450;
        const tableTop = doc.y;

        doc.fontSize(12)
            .text('Producto', itemX, tableTop)
            .text('Código', codigoX, tableTop)
            .text('Lote', loteX, tableTop)
            .text('Cantidad', cantidadX, tableTop);
        doc.moveTo(itemX, tableTop + 15).lineTo(550, tableTop + 15).stroke();

        let y = tableTop + 25;
        detalles.forEach(item => {
            doc.fontSize(10)
                .text(item.nombre_producto, itemX, y)
                .text(item.codigo_barras, codigoX, y)
                .text(item.nro_lote, loteX, y)
                .text(String(item.cantidad), cantidadX, y);
            y += 20;
        });

        doc.moveTo(itemX, y + 10).lineTo(550, y + 10).stroke();

        // Firmas
        const firmaY = y + 30;
        const firma1X = itemX;
        const firma2X = 300;

        // 📌 Entregado por
        if (remisionData.entregado_por_nombre) {
            doc.fontSize(10).text(`Entregado por: ${remisionData.entregado_por_nombre}`, firma1X, firmaY);
        } else {
            doc.fontSize(10).text('Entregado por:', firma1X, firmaY);
        }

        // Dibujar firma primero
        if (remisionData.firma_entrega) {
            try {
                doc.image(Buffer.from(remisionData.firma_entrega), firma1X, firmaY + 15, { width: 150, height: 35 });
            } catch (e) {
                console.error('Error mostrando firma_entrega:', e);
            }
        }

        // Línea después de la firma
        doc.text('____________________________', firma1X, firmaY + 42);

        // 📌 Recibe
        if (remisionData.recibido_por_nombre) {
            doc.fontSize(10).text(`Recibe: ${remisionData.recibido_por_nombre}`, firma2X, firmaY);
        } else {
            doc.fontSize(10).text('Recibe:', firma2X, firmaY);
        }

        // Dibujar firma primero
        if (remisionData.firma_recibe) {
            try {
                doc.image(Buffer.from(remisionData.firma_recibe), firma2X, firmaY + 15, { width: 150, height: 35 });
            } catch (e) {
                console.error('Error mostrando firma_recibe:', e);
            }
        }

        // Línea después de la firma
        doc.text('____________________________', firma2X, firmaY + 42);

        doc.end();
    } catch (err) {
        console.error('❌ Error generando PDF:', err);
        res.status(500).send('Error interno al generar PDF');
    }
});

// Firmar entrega
router.post('/remision/firmar-entrega/:id', isLoggedIn, async (req, res) => {
    const { firmaEntregaBase64 } = req.body;
    const idRemision = req.params.id;
    const idOperario = req.user.id_operario;;

    if (!idOperario) {
        return res.status(401).json({ success: false, mensaje: 'No hay operario logueado' });
    }

    try {
        const firmaBuffer = Buffer.from(
            firmaEntregaBase64.replace(/^data:image\/\w+;base64,/, ''),
            'base64'
        );

        await pool.query(
            'UPDATE remision SET firma_entrega = ?, entregado_por = ? WHERE id_remision = ?',
            [firmaBuffer, idOperario, idRemision]
        );

        res.json({ success: true, mensaje: 'Firma de entrega guardada con éxito' });
    } catch (error) {
        console.error('❌ Error al guardar firma de entrega:', error);
        res.status(500).json({ success: false, mensaje: 'Error interno al guardar la firma' });
    }
});

// Firmar recibido
router.post('/remision/firmar-recibe/:id', isLoggedIn, async (req, res) => {
    const { firmaRecibeBase64 } = req.body;
    const idRemision = req.params.id;
    const idOperario = req.user.id_operario;

    if (!idOperario) {
        return res.status(401).json({ success: false, mensaje: 'No hay operario logueado' });
    }

    try {
        const firmaBuffer = Buffer.from(
            firmaRecibeBase64.replace(/^data:image\/\w+;base64,/, ''),
            'base64'
        );

        await pool.query(
            'UPDATE remision SET firma_recibe = ?, recibido_por = ? WHERE id_remision = ?',
            [firmaBuffer, idOperario, idRemision]
        );

        res.json({ success: true, mensaje: 'Firma de recibido guardada con éxito' });
    } catch (error) {
        console.error('❌ Error al guardar firma de recibido:', error);
        res.status(500).json({ success: false, mensaje: 'Error interno al guardar la firma' });
    }
});

module.exports = router;