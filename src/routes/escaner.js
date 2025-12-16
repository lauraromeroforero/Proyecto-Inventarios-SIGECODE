const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();
const multer = require('multer');
const pool = require('../database');
const Jimp = require("jimp");
const { decode } = require("@zxing/text-encoding");
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

router.get('/scan', isLoggedIn, (req, res) => {
    res.render('products/scan');
});

// 📤 RUTA PARA ACTUALIZAR INVENTARIO CON CÓDIGO ESCANEADO
router.post("/api/actualizar-inventario", isLoggedIn, async (req, res) => {
    try {
        const { codigo } = req.body;

        if (!codigo) {
            return res.status(400).json({ success: false, mensaje: "Código no proporcionado" });
        }

        // Buscar producto por código de barras
        const [producto] = await pool.query("SELECT id_productos FROM productos WHERE codigo_barras = ?", [codigo]);

        if (producto.length === 0) {
            return res.status(404).json({ success: false, mensaje: "Producto no encontrado" });
        }

        const idProducto = producto[0].id_productos;

        // Buscar el lote más reciente de ese producto
        const [lotes] = await pool.query(
            "SELECT * FROM lotes_productos WHERE id_productos = ? ORDER BY fecha_ingreso DESC LIMIT 1",
            [idProducto]
        );

        if (lotes.length === 0) {
            return res.status(404).json({ success: false, mensaje: "No se encontraron lotes para el producto" });
        }

        const lote = lotes[0];

        // Actualizar cantidad (+1)
        const nuevaCantidad = lote.cantidad + 1;

        await pool.query("UPDATE lotes_productos SET cantidad = ? WHERE id_lote = ?", [nuevaCantidad, lote.id_lote]);

        res.json({ success: true, mensaje: `Cantidad del lote actualizada a ${nuevaCantidad}` });

    } catch (error) {
        console.error("❌ Error al actualizar inventario:", error);
        res.status(500).json({ success: false, mensaje: "Error interno del servidor" });
    }
});

// 📸 RUTA PARA PROCESAR IMAGEN Y EXTRAER CÓDIGO DE BARRAS
router.post("/escanear", isLoggedIn, upload.single("imagen"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No se ha proporcionado ninguna imagen" });

        const buffer = req.file.buffer;

        // 📷 Procesar imagen con Jimp
        const img = await Jimp.read(buffer);
        img.grayscale();
        const imgBuffer = await img.getBufferAsync(Jimp.MIME_PNG);

        // 🏷️ Decodificar con ZXing
        const result = await decode(imgBuffer);

        if (!result || result.length === 0) return res.status(404).json({ error: "No se encontraron códigos de barras" });

        const codigos = result.map(code => code.text);

        res.json({ codigos });
    } catch (error) {
        console.error("Error procesando la imagen:", error);
        res.status(500).json({ error: "Error procesando la imagen" });
    }
});

router.get('/scanrecount', isLoggedIn, (req, res) => {
    res.render('products/scanrecount');
});

let conteoTemporal = {}; // Almacena temporalmente los conteos de los códigos escaneados

// 📤 RUTA PARA ESCANEAR Y CONTAR PRODUCTOS MASIVAMENTE
router.post("/api/contar-productos", isLoggedIn, async (req, res) => {
    try {
        const { codigos } = req.body;
        if (!codigos || !Array.isArray(codigos)) return res.status(400).json({ success: false, mensaje: "Lista de códigos inválida" });

        codigos.forEach(codigo => {
            if (!conteoTemporal[codigo]) {
                conteoTemporal[codigo] = 1;
            } else {
                conteoTemporal[codigo] += 1;
            }
        });

        res.json({ success: true, mensaje: "Productos contados", conteo: conteoTemporal });
    } catch (error) {
        console.error("❌ Error en conteo:", error);
        res.status(500).json({ success: false, mensaje: "Error interno" });
    }
});

// 📤 RUTA PARA FINALIZAR CONTEO Y COMPARAR CON INVENTARIO
router.post("/api/finalizar-conteo", isLoggedIn, async (req, res) => {
    try {
        let diferencias = [];
        let codigosEscaneados = Object.keys(conteoTemporal);

        if (codigosEscaneados.length === 0) {
            return res.status(400).json({ success: false, mensaje: "No hay productos escaneados" });
        }

        const claves = codigosEscaneados.map(clave => {
            const [codigo_barras, nro_lote] = clave.split(" | ");
            return [codigo_barras.trim(), nro_lote.trim()];
        });

        const condiciones = claves.map(() => `(p.codigo_barras = ? AND l.nro_lote = ?)`).join(" OR ");
        const valores = claves.flat();

        const query = `
            SELECT CONCAT(p.codigo_barras, ' | ', l.nro_lote) AS clave, l.cantidad
            FROM productos p
            JOIN lotes_productos l ON p.id_productos = l.id_productos
            WHERE ${condiciones}
        `;

        const rows = await pool.query(query, valores);

        const productosBD = {};
        rows.forEach(row => {
            productosBD[row.clave] = parseInt(row.cantidad, 10);
        });

        codigosEscaneados.forEach(clave => {
            const cantidadBD = productosBD[clave] || 0;
            const cantidadEscaneada = conteoTemporal[clave];

            if (cantidadBD !== cantidadEscaneada) {
                diferencias.push({
                    codigo: clave,
                    mensaje: `❌ Diferencia detectada`,
                    en_base_datos: cantidadBD,
                    escaneado: cantidadEscaneada,
                    diferencia: cantidadEscaneada - cantidadBD
                });
            }
        });

        conteoTemporal = {}; // Limpia para el siguiente conteo
        res.json({ success: true, mensaje: "Conteo finalizado", diferencias });
    } catch (error) {
        console.error("❌ Error al finalizar conteo:", error);
        res.status(500).json({ success: false, mensaje: "Error interno del servidor" });
    }
});

// 📤 RUTA PARA ACTUALIZAR INVENTARIO CON LAS CANTIDADES ESCANEADAS
router.post("/api/actualizar-inventario-nuevo", isLoggedIn, async (req, res) => {
    let connection;
    try {
        const { diferencias } = req.body;

        if (!diferencias || !Array.isArray(diferencias) || diferencias.length === 0) {
            return res.status(400).json({ success: false, mensaje: "No hay diferencias para actualizar" });
        }

        connection = await pool.promise().getConnection();
        await connection.beginTransaction();

        for (const diferencia of diferencias) {
            const { codigo, escaneado } = diferencia;
            const partes = codigo.split(" | ").map(x => x.trim());
            const codigo_barras = partes[0];
            const nro_lote = partes[1];
            const fecha_vencimiento = partes[2] && /^\d{4}-\d{2}-\d{2}$/.test(partes[2]) ? partes[2] : null;

            // Buscar el producto
            const [[producto]] = await connection.query(`
                SELECT id_productos FROM productos WHERE codigo_barras = ?
            `, [codigo_barras]);

            if (!producto) {
                console.warn(`❌ Producto no encontrado para código: ${codigo_barras}`);
                continue;
            }

            const id_producto = producto.id_productos;

            // Buscar el lote
            const [[lote]] = await connection.query(`
                SELECT id_lote FROM lotes_productos 
                WHERE id_productos = ? AND nro_lote = ?
            `, [id_producto, nro_lote]);

            if (lote) {
                // Si el lote existe, actualizar cantidad
                await connection.query(`UPDATE lotes_productos SET cantidad = ? WHERE id_lote = ?`, [escaneado, lote.id_lote]);
            } else {
                // Insertar el nuevo lote con la fecha de vencimiento desde el código escaneado
                await connection.query(`INSERT INTO lotes_productos (id_productos, nro_lote, cantidad, fecha_vencimiento) VALUES (?, ?, ?, ?)`, [id_producto, nro_lote, escaneado, fecha_vencimiento]);

                console.log(`✅ Nuevo lote insertado para ${codigo_barras} - ${nro_lote} con vencimiento ${fecha_vencimiento}`);
            }
        }

        await connection.commit();
        res.json({ success: true, mensaje: "Inventario actualizado correctamente (lotes nuevos creados si era necesario)" });

    } catch (error) {
        console.error("❌ Error al actualizar inventario:", error);
        if (connection) await connection.rollback();
        res.status(500).json({ success: false, mensaje: "Error interno del servidor" });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;