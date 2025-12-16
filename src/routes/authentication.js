const express = require('express');
const router = express.Router();
const passport = require('passport');
const pool = require('../database');
const {isLoggedIn, isNotLoggedIn} = require('../lib/auth');
const Crypto = require('crypto');
const nodemailer = require('nodemailer');
const helpers = require('../lib/helpers');

router.get("/signup", isNotLoggedIn, (req, res) => {
    res.render('auth/signup');
});

router.post("/signup", isNotLoggedIn, passport.authenticate('local.signup', {
    successRedirect: '/profile',
    failureRedirect: '/signup',
    failureFlash: true
}));

router.get('/signin', isNotLoggedIn, (req, res) =>{
    res.render('auth/signin');
})

router.post('/signin', isNotLoggedIn, (req, res, next) => {
    passport.authenticate('local.signin', (err, user, info) => {
        if (err) return next(err);
        if (!user) return res.redirect('/signin');

        req.logIn(user, (err) => {
            if (err) return next(err);

            // Aquí seteamos el mensaje de éxito
            req.flash('success', '✅ Inicio de sesión exitoso');
            return res.redirect('profile');
        });
    })(req, res, next);
});

router.get('/profile', isLoggedIn, (req, res) => {
    res.render('profile', {
        message: req.flash('success')
    });
});

router.get('/logout', isLoggedIn, (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);  // Si hay un error, pasa el error al siguiente middleware
        }
        req.flash('success', 'Hasta la proxima');
        res.redirect('/signin');
    });
});

router.get('/forgotpassword', (req, res) => {
    res.render('auth/forgotpassword');
});

// Ruta para manejar la solicitud de recuperación de contraseña
router.post('/forgotpassword', async (req, res) => {
    const email = req.body.email;

    try {
        // Buscar al usuario en la base de datos
        const [usuario] = await pool.query('SELECT * FROM operario WHERE email = ?', [email]);

        if (!usuario) {
            req.flash('error', 'El usuario no existe');
            return res.redirect('/signin');
        }

        // Generar un token único de recuperación
        const token = Crypto.randomBytes(20).toString('hex');
        
        // Establecer una fecha de expiración (10 minutos)
        const expireDate = new Date();
        expireDate.setMinutes(expireDate.getMinutes() + 5);  // Expirará en 10 minutos

        // Guardar el token y la fecha de expiración en la sesión
        req.session.resetToken = token;
        req.session.resetTokenExpire = expireDate;

        // Generar la URL de recuperación
        const resetUrl = `http://${req.headers.host}/resetpassword/${token}`;

        // Configuración de nodemailer para enviar el correo
        const transporter = nodemailer.createTransport({
            service: 'gmail',  // Cambia esto si usas otro servicio de correo
            auth: {
                user: 'l.forerocfmacrodent@gmail.com',  // Tu correo
                pass: 'zepg sgoa opkr youi'        // Tu contraseña de correo o token de aplicación
            }
        });

        const mailOptions = {
            to: email,
            from: 'l.forerocfmacrodent@gmail.com',
            subject: 'Recuperación de Contraseña',
            text: `Hola,\n\nUsted ha solicitado restablecer su contraseña. Haga clic en el siguiente enlace para continuar: \n\n${resetUrl}\n\nSi no solicitó esto, ignore este correo.`
        };

        // Enviar el correo
        await transporter.sendMail(mailOptions);

        req.session.email = email;

        req.flash('success', 'Te hemos enviado un correo con las instrucciones para recuperar tu contraseña.');
        res.redirect('/signin');
    } catch (error) {
        console.error('Error al recuperar contraseña:', error);
        req.flash('error', 'Ocurrió un error al procesar tu solicitud. Intenta nuevamente.');
        res.redirect('/forgotpassword');
    }
});

// Ruta para manejar el restablecimiento de contraseña
router.get('/resetpassword/:token', async (req, res) => {
    const { token } = req.params;
    // Recuperamos el correo de la sesión
    const email = req.session.email;
    if (!email) {
        req.flash('error', 'Tu solicitud de recuperación de contraseña ha expirado.');
        return res.redirect('/forgotpassword');
    }
    // Verificar si el token en la URL coincide con el guardado en la sesión
    if (token !== req.session.resetToken) {
        req.flash('error', 'Este enlace de recuperación no es válido.');
        return res.redirect('/forgotpassword');
    }

    // Verificar si el token ha expirado
    const currentTime = new Date();
    if (req.session.resetTokenExpire < currentTime) {
        req.flash('error', 'El enlace de recuperación ha expirado.');
        return res.redirect('/forgotpassword');
    }
    res.render('auth/resetpassword', { token });
});

// Ruta para manejar el restablecimiento de la contraseña
router.post('/resetpassword/:token', async (req, res) => {
    const { password, confirmPassword } = req.body;
    const email = req.session.email;
    console.log(email)
    const { token } = req.params;
    // Verificar si las contraseñas coinciden
    if (password !== confirmPassword) {
        req.flash('error', 'Las contraseñas no coinciden.');
        return res.redirect(`/resetpassword/${req.params.token}`);
    }
    // Verificar que el token no haya expirado
    const currentTime = new Date();
    if (req.session.resetTokenExpire < currentTime) {
        req.flash('error', 'El enlace de recuperación ha expirado.');
        return res.redirect('/forgotpassword');
    }

    try {
         // Verificar si el token en la URL coincide con el guardado en la sesión
         if (token !== req.session.resetToken) {
            req.flash('error', 'Este enlace de recuperación no es válido.');
            return res.redirect('/forgotpassword');
        }

        // Verificar si el correo existe
        if (!email) {
            req.flash('error', 'No se ha proporcionado un correo electrónico.');
            return res.redirect(`/resetpassword/${req.params.token}`);
        }

        // Encriptar la nueva contraseña
        const encryptedPassword = await helpers.encryptPassword(password);

        // Actualizar la contraseña en la base de datos
        const result = await pool.query('UPDATE operario SET password = ? WHERE email = ?', [encryptedPassword, email]);

        // Limpiar el token de la sesión después de restablecer la contraseña
        req.session.resetToken = null;
        req.session.resetTokenExpire = null;

        if (result.affectedRows === 0) {
            req.flash('warning', 'No se pudo actualizar la contraseña, por favor intenta nuevamente.');
            return res.redirect(`/resetpassword/${req.params.token}`);
        }

        req.flash('success', 'Tu contraseña ha sido actualizada correctamente.');
        res.redirect('/signin');  // Redirige al usuario a la página de inicio de sesión
    } catch (error) {
        console.error('Error al actualizar la contraseña:', error);
        req.flash('error', 'Ocurrió un error al restablecer la contraseña. Intenta nuevamente.');
        res.redirect(`/resetpassword/${req.params.token}`);
    }
});

module.exports = router;