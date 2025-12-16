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
// Ruta GET para mostrar el formulario
router.get('/historial', isLoggedIn, (req, res) => {
    console.log('Entró a products/historial');
    res.render('products/historial');
});

module.exports = router;