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

router.post('/lotes/add', isLoggedIn, async (req, res) => {
    const { id_productos, nro_lote, cantidad, fecha_vencimiento } = req.body;

    if (!id_productos || !nro_lote || !cantidad) {
        return res.status(400).send('Faltan datos obligatorios.');
    }

    try {
        // Verificar si ya existe ese lote para ese producto
        const rows = await pool.query(
            `SELECT id_lote, cantidad FROM lotes_productos WHERE id_productos = ? AND nro_lote = ?`,
            [id_productos, nro_lote]
        );

        if (rows.length > 0) {
            // 👉 Si existe, sumar la cantidad
            const loteExistente = rows[0];
            const nuevaCantidad = loteExistente.cantidad + parseInt(cantidad);

            await pool.query(
                `UPDATE lotes_productos SET cantidad = ? WHERE id_lote = ?`,
                [nuevaCantidad, loteExistente.id_lote]
            );

        } else {
            // 👉 Si no existe, insertar normalmente
            const query = `
                INSERT INTO lotes_productos (id_productos, nro_lote, cantidad, fecha_vencimiento)
                VALUES (?, ?, ?, ?)
            `;

            await pool.query(query, [
                id_productos,
                nro_lote,
                cantidad,
                fecha_vencimiento || null
            ]);
        }

        res.redirect('/products/all');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al guardar el lote');
    }
});

// Subir excel nuevos lotes desde Excel
router.post('/upload-excel-lotes', isLoggedIn, upload.single('excelFile'), async (req, res) => {
    try {
        // Leer archivo Excel
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        console.log('🔎 Datos del Excel:', data);

        for (const row of data) {
            // Extraer campos con distintos posibles nombres
            const codigo_barras = row.codigo_barras || row.CODIGO_BARRAS || row['Código Barras'];
            const nro_lote = String(row.nro_lote || row.NRO_LOTE || row['Nro Lote']).trim();
            const cantidad = row.cantidad || row.CANTIDAD || row.Cantidad;
            let fecha_vencimiento = row.fecha_vencimiento || row.FECHA_VENCIMIENTO || row['Fecha Vencimiento'];

            console.log(`Procesando: CB: ${codigo_barras}, Lote: ${nro_lote}, Cantidad: ${cantidad}, Vencimiento: ${fecha_vencimiento}`);

            // Validar datos obligatorios
            if (!codigo_barras || !nro_lote || !cantidad) {
                req.flash('warning', `⚠️ Faltan datos: Código: ${codigo_barras}, Lote: ${nro_lote}, Cantidad: ${cantidad}`);
                continue; // Saltar fila incompleta
            }

            // Convertir fecha si es serial
            if (typeof fecha_vencimiento === 'number') {
                fecha_vencimiento = excelDateToJSDate(fecha_vencimiento);
            } else if (fecha_vencimiento instanceof Date) {
                fecha_vencimiento = fecha_vencimiento.toISOString().split('T')[0];
            } else if (typeof fecha_vencimiento === 'string' && fecha_vencimiento.trim() === '') {
                fecha_vencimiento = null;
            } else if (!fecha_vencimiento) {
                fecha_vencimiento = null;
            }

            // Verificar existencia del producto
            const [productos] = await pool.promise().query('SELECT id_productos FROM productos WHERE codigo_barras = ?', [codigo_barras]);
            console.log(codigo_barras);

            if (productos.length === 0) {
                req.flash('warning', `⚠️ Producto no encontrado: ${codigo_barras}`);
                continue;
            }

            const idProducto = productos[0].id_productos;

            // Verificar existencia del lote
            const [loteExistente] = await pool.promise().query('SELECT id_lote FROM lotes_productos WHERE id_productos = ? AND nro_lote = ?', [idProducto, nro_lote]);
            console.log(idProducto, nro_lote);

            if (loteExistente.length > 0) {
                // Actualizar cantidad si existe
                await pool.query(
                    'UPDATE lotes_productos SET cantidad = cantidad + ? WHERE id_productos = ? AND nro_lote = ?',
                    [cantidad, idProducto, nro_lote]
                );
                console.log(`✅ Cantidad sumada al lote ${nro_lote}`);
            } else {
                // Insertar nuevo lote
                await pool.query(
                    'INSERT INTO lotes_productos (id_productos, nro_lote, cantidad, fecha_vencimiento) VALUES (?, ?, ?, ?)',
                    [idProducto, nro_lote, cantidad, fecha_vencimiento]
                );
                console.log(`➕ Nuevo lote creado: ${nro_lote}`);
            }
        }

        req.flash('success', `✅ Archivo procesado correctamente.`);
        res.redirect('/products/all');

    } catch (error) {
        console.error('❌ Error procesando archivo:', error);
        req.flash('error', '❌ Ocurrió un error procesando el archivo.');
        res.redirect('/products/all');
    }
});

// Ruta GET para eliminar un lote
router.get('/delete-lote/:id_lote', isLoggedIn, async (req, res) => {
    const { id_lote } = req.params;
    console.log(id_lote)

    try {
        // Verifica si el lote existe
        const [lote] = await pool.query('SELECT * FROM lotes_productos WHERE id_lote = ?', [id_lote]);

        if (!lote) {
            return res.status(404).send('Lote no encontrado.');
        }

        // Elimina el lote
        await pool.query('DELETE FROM lotes_productos WHERE id_lote = ?', [id_lote]);

        req.flash('success', '✅ Lote eliminado correctamente.');

        // Redirige a la página con la lista de productos actualizada
        res.redirect('/products/all');
    } catch (err) {
        console.error('Error al eliminar el producto:', err);
        req.flash('error', '❌ No se pudo eliminar el producto, existen lotes y remisiones con ese producto.');
        res.redirect('/products/all');
    }
});

router.post('/update-lote', isLoggedIn, async (req, res) => {
    const { nro_lote, cantidad, id_productos } = req.body;

    // Verificar que los campos obligatorios estén presentes
    if (!nro_lote || !id_productos || !cantidad) {
        return res.status(400).send('Todos los campos son obligatorios.');
    }

    try {
        // Buscar el lote correcto:
        const lote = await pool.query(`SELECT * FROM lotes_productos WHERE nro_lote = ? AND id_productos = ?`, [nro_lote, id_productos]);

        if (!lote || lote.length === 0) {
            return res.status(404).send('No se encontró lote disponible para editar.');
        }

        // Verificar si hubo cambios
        let cambiosDetectados = false;

        if (cantidad && cantidad != lote[0].cantidad) {
            cambiosDetectados = true;
        }

        // Si se detectaron cambios, actualizar el lote
        if (cambiosDetectados) {
            const updatedLote = {
                cantidad: cantidad
                // nro_lote no se actualiza porque es solo de lectura en tu formulario
            };

            console.log('Datos que se enviarán a la base de datos para actualizar el lote:', updatedLote);

            // Hacer el update SOLO a ese
            await pool.query(`UPDATE lotes_productos SET cantidad = ? WHERE nro_lote = ? AND id_productos = ?`, [cantidad, nro_lote, id_productos]);

            req.flash('success', 'Lote actualizado correctamente.');
            res.redirect('/products/all');
        } else {
            req.flash('warning', 'No se realizaron cambios en el lote.');
            res.redirect('/products/all');
        }

    } catch (err) {
        console.error('Error al actualizar el lote:', err);
        res.status(500).send('Hubo un error al actualizar el lote.');
    }
});

module.exports = router;