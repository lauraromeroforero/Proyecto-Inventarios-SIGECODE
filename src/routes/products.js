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

// Ruta GET para mostrar el formulario
router.get('/add', isLoggedIn, (req, res) => {
    res.render('products/add');
});

// Ruta POST para recibir y almacenar el producto
router.post('/add', isLoggedIn, upload.single('image'), async (req, res) => {
    const { nombre, codigo_barras, presentacion, tamano, color, reg_invima, proovedor, descripcion, stock_minimo } = req.body;

    // Verifica si se recibió la imagen
    const image = req.file ? req.file.buffer : null;

    // Verifica que los campos obligatorios estén presentes
    if (!nombre || !codigo_barras || !presentacion || !tamano || !color || !reg_invima || !proovedor || !stock_minimo) {
        return res.status(400).send('Todos los campos son obligatorios, incluyendo la imagen.');
    }

    try {
        // Realizar la inserción en la base de datos
        const query = `
            INSERT INTO productos (nombre, codigo_barras, presentacion, tamano, color, reg_invima, proovedor, descripcion, stock_minimo, img)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Ejecutar la consulta SQL con los valores proporcionados en el formulario
        await pool.execute(query, [
            nombre,
            codigo_barras,
            presentacion,
            tamano,
            color,
            reg_invima,
            proovedor,
            descripcion,
            stock_minimo,
            image
        ]);

        // Redirigir a la lista de productos
        res.redirect('/products/all');
    } catch (err) {
        console.error(err);
        res.status(500).send('Hubo un error al guardar el producto');
    }
});

router.get('/products/search', isLoggedIn, async (req, res) => {
    const { nombre, codigo_barras, presentacion, proveedor } = req.query;

    // Lógica para buscar los productos en la base de datos o en la colección
    let query = {};
    if (nombre) query.nombre = new RegExp(nombre, 'i'); // Búsqueda insensible a mayúsculas
    if (codigo_barras) query.codigo_barras = new RegExp(codigo_barras, 'i');
    if (presentacion) query.presentacion = new RegExp(presentacion, 'i');
    if (proveedor) query.proveedor = new RegExp(proveedor, 'i');

    Product.find(query, (err, productos) => {
        if (err) return res.status(500).send('Error en la búsqueda');
        res.render('productos', { productos }); // Pasar los productos filtrados al renderizado
    });
});

// Ruta GET para mostrar todos los productos
router.get('/all', isLoggedIn, async (req, res) => {
    const mensajes = {
        success: req.flash('success'),
        warning: req.flash('warning'),
        error: req.flash('error')
    };
    try {
        // 1️⃣ Obtener todos los productos y la suma de cantidades por lotes
        const products = await pool.query(`
      SELECT p.*, COALESCE(SUM(l.cantidad), 0) AS cantidad_total 
      FROM productos p 
      LEFT JOIN lotes_productos l ON p.id_productos = l.id_productos 
      GROUP BY p.id_productos
    `);

        console.log('Productos recuperados:', products);

        // 2️⃣ Para cada producto, obtener sus lotes agrupados
        for (const product of products) {
            const lotes = await pool.query(`
        SELECT id_lote, nro_lote, cantidad, fecha_vencimiento, fecha_ingreso
        FROM lotes_productos
        WHERE id_productos = ?
        ORDER BY fecha_vencimiento ASC
      `, [product.id_productos]);

            product.lotes_agrupados = lotes;
        }

        // Asegura que `products` sea siempre un arreglo
        const productList = Array.isArray(products) ? products : [products];

        // 3️⃣ Redimensionar imágenes (opcional)
        for (let product of products) {
            if (product.img) {
                const resizedImage = await sharp(product.img)
                    .resize(300, 300)
                    .toBuffer();
                product.img = resizedImage.toString('base64');
            }
        }

        console.log('🔎 Productos con lotes agrupados:', JSON.stringify(products, null, 2));

        // 4️⃣ Obtener el carrito para este operario
        const idOperario = req.user.id_operario;

        const carrito = await pool.query(`
            SELECT cr.*, p.nombre, p.codigo_barras
            FROM carrito_remision cr
            JOIN productos p ON cr.id_productos = p.id_productos
            WHERE cr.id_operario = ?
        `, [idOperario]);

        console.log('🛒 Carrito recuperado:', carrito);

        // 5️⃣ Renderizar la vista con productos y carrito incluidos
        res.render('products/all', { products: productList, carrito, mensajes });

    } catch (err) {
        console.error('Error al recuperar los productos:', err);
        res.status(500).send(`Hubo un error al recuperar los productos: ${err.message}`);
    }
});

// Ruta GET para eliminar un producto
router.get('/delete/:id_productos', isLoggedIn, async (req, res) => {
    const { id_productos } = req.params;

    try {
        // Verifica si el producto existe
        const [product] = await pool.query('SELECT * FROM productos WHERE id_productos = ?', [id_productos]);

        if (!product) {
            return res.status(404).send('Producto no encontrado.');
        }

        // Elimina el producto
        await pool.query('DELETE FROM productos WHERE id_productos = ?', [id_productos]);

        req.flash('success', '✅ Producto eliminado correctamente.');

        // Redirige a la página con la lista de productos actualizada
        res.redirect('/products/all');
    } catch (err) {
        console.error('Error al eliminar el producto:', err);
        req.flash('error', '❌ No se pudo eliminar el producto, existen lotes y remisiones con ese producto.');
        res.redirect('/products/all');
    }
});

router.post('/update/:id_productos', isLoggedIn, upload.single('image'), async (req, res) => {
    const { id_productos } = req.params;  // Recogemos el id_productos desde la URL
    const { nombre, codigo_barras, tamano, color, descripcion, presentacion, reg_invima, proovedor, stock_minimo } = req.body;

    const image = req.file ? req.file.buffer : null;

    // Verificar que los campos obligatorios estén presentes
    if (!id_productos || !nombre || !codigo_barras || !tamano || !color || !descripcion || !presentacion || !reg_invima || !proovedor || !stock_minimo) {
        return res.status(400).send('Todos los campos son obligatorios.');
    }

    try {
        // Consultar el producto actual para ver qué ha cambiado
        const [product] = await pool.query('SELECT * FROM productos WHERE id_productos = ?', [id_productos]);

        if (!product) {
            return res.status(404).send('Producto no encontrado.');
        }

        // Verificar si hubo cambios en los datos
        let cambiosDetectados = false;

        if (nombre && nombre !== product.nombre) {
            cambiosDetectados = true;
        }
        if (codigo_barras && codigo_barras !== product.codigo_barras) {
            cambiosDetectados = true;
        }
        if (tamano && tamano !== product.tamano) {
            cambiosDetectados = true;
        }
        if (color && color !== product.color) {
            cambiosDetectados = true;
        }
        if (descripcion && descripcion !== product.descripcion) {
            cambiosDetectados = true;
        }
        if (presentacion && presentacion !== product.presentacion) {
            cambiosDetectados = true;
        }
        if (reg_invima && reg_invima !== product.reg_invima) {
            cambiosDetectados = true;
        }
        if (proovedor && proovedor !== product.proovedor) {
            cambiosDetectados = true;
        }
        if (stock_minimo && stock_minimo !== product.stock_minimo) {
            cambiosDetectados = true;
        }

        // Verificar si se subió una imagen nueva
        if (image) {
            cambiosDetectados = true;
        }

        // Si se han detectado cambios, actualizar el producto
        if (cambiosDetectados) {
            // Preparar los datos actualizados
            const updatedProduct = {
                nombre,
                codigo_barras,
                tamano,
                color,
                descripcion,
                presentacion,
                reg_invima,
                proovedor,
                stock_minimo,
                img: image ? image : product.img // Si no se ha subido una nueva imagen, mantenemos la existente
            };

            console.log('Datos que se enviarán a la base de datos para actualizar el producto:', updatedProduct);

            // Actualizar el producto en la base de datos
            await pool.query('UPDATE productos SET ? WHERE id_productos = ?', [updatedProduct, id_productos]);
            res.redirect('/products/all');
        } else {
            // Si no se han detectado cambios, informamos al usuario
            req.flash('success', 'No se realizaron cambios en el producto');
            res.redirect('/products/all');
        }

    } catch (err) {
        console.error('Error al actualizar el producto:', err);
        res.status(500).send('Hubo un error al actualizar el producto');
    }
});

// Ruta para generar el archivo Excel de productos
router.get('/descargar-excel-productos', isLoggedIn, async (req, res) => {
    try {
        // Obtener los datos de la base de datos
        const result = await pool.query('SELECT * FROM productos');

        // Crear un nuevo libro de trabajo de Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Productos');  // Nombre de la hoja

        // Definir las columnas
        worksheet.columns = [
            { header: 'ID', key: 'id_productos', width: 5 },
            { header: 'Nombre', key: 'nombre', width: 40 },
            { header: 'Codigo de Barras', key: 'codigo_barras', width: 20 },
            { header: 'Cantidad', key: 'cantidad', width: 10 },
            { header: 'Tamaño', key: 'tamano', width: 10 },
            { header: 'Color', key: 'color', width: 10 },
            { header: 'Descripción', key: 'descripcion', width: 30 },
        ];

        // Estilo de las celdas del encabezado
        worksheet.getRow(1).font = { bold: true, size: 12 }; // Negrita y tamaño de fuente para el encabezado
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };  // Centrado
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F81BD' } // Color de fondo del encabezado (azul)
        };

        // Establecer los bordes para las celdas del encabezado
        worksheet.getRow(1).eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF000000' } },
                left: { style: 'thin', color: { argb: 'FF000000' } },
                bottom: { style: 'thin', color: { argb: 'FF000000' } },
                right: { style: 'thin', color: { argb: 'FF000000' } },
            };
        });

        // Agregar los datos de la base de datos al archivo Excel
        result.forEach((row, index) => {
            const rowIndex = index + 2; // Las filas de datos empiezan después de la fila 1 (encabezado)

            worksheet.addRow({
                id_productos: row.id_productos,
                nombre: row.nombre,
                codigo_barras: row.codigo_barras,
                cantidad: row.cantidad,
                tamano: row.tamano,
                color: row.color,
                descripcion: row.descripcion,
            });

            // Estilo para cada celda de la fila de datos
            const currentRow = worksheet.getRow(rowIndex);
            currentRow.alignment = { vertical: 'middle', horizontal: 'center' };  // Centrado
            currentRow.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF000000' } },
                    left: { style: 'thin', color: { argb: 'FF000000' } },
                    bottom: { style: 'thin', color: { argb: 'FF000000' } },
                    right: { style: 'thin', color: { argb: 'FF000000' } },
                };
            });
        });

        // Establecer los encabezados de la respuesta para indicar que es un archivo descargable
        res.setHeader('Content-Disposition', 'attachment; filename=productos.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Escribir el archivo en la respuesta
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error al generar el archivo Excel:', error);
        res.status(500).send('Error al generar el archivo');
    }
});

// Subir productos nuevos desde Excel
router.post('/upload-excel-products', isLoggedIn, upload.single('excelFile'), async (req, res) => {
    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        console.log('📂 Datos del Excel:', data);

        for (const row of data) {
            // Extraer columnas (nombres posibles)
            const nombre = row.nombre || row.Nombre || row['Nombre Producto'];
            const codigo_barras = row.codigo_barras || row.CODIGO_BARRAS || row['Código Barras'];
            const presentacion = row.presentacion || row.Presentacion || row['Presentación'];
            const tamano = row.tamano || row.Tamaño || row['Tamaño'];
            const color = row.color || row.Color || row['Color'];
            const reg_invima = row.reg_invima || row.REG_INVIMA || row['Registro Invima'] || 'N/A';
            const proovedor = row.proovedor || row.Proveedor || row['Proveedor'];
            const descripcion = row.descripcion || row.Descripcion || row['Descripción'] || 'Descripción'; // Aquí incluí 'Descripción'
            const stock_minimo = row.stock_minimo || row.Stock_Minimo || row['Stock Minimo'] || 3;

            console.log(`➡️ Procesando: ${nombre}, CB: ${codigo_barras}`);

            // Validar campos obligatorios
            if (!nombre || !codigo_barras || !presentacion || !tamano || !color || !reg_invima || !proovedor) {
                req.flash('warning', `⚠️ Faltan campos obligatorios para: ${nombre || 'Sin nombre'} (${codigo_barras || 'Sin código'})`);
                continue;
            }

            // Revisar si ya existe ese código de barras
            const [productoExistente] = await pool.promise().query(
                'SELECT id_productos FROM productos WHERE codigo_barras = ?',
                [codigo_barras]
            );

            if (productoExistente.length > 0) {
                req.flash('warning', `⚠️ Ya existe un producto con código de barras: ${codigo_barras}`);
                continue;
            }

            // Insertar producto nuevo
            await pool.promise().query(
                `INSERT INTO productos 
         (nombre, codigo_barras, presentacion, tamano, color, reg_invima, proovedor, descripcion, stock_minimo, img) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
                [nombre, codigo_barras, presentacion, tamano, color, reg_invima, proovedor, descripcion, stock_minimo]
            );

            console.log(`✅ Producto agregado: ${nombre} (${codigo_barras})`);
        }

        req.flash('success', `✅ Archivo procesado correctamente. Productos agregados.`);
        res.redirect('/products/all');

    } catch (error) {
        console.error('❌ Error procesando archivo:', error);
        req.flash('error', '❌ Ocurrió un error procesando el archivo de productos.');
        res.redirect('/products/all');
    }
});

module.exports = router;