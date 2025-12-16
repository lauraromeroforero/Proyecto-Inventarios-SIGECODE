const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

const pool = require('../database');
const helpers = require('./helpers');

passport.use('local.signin', new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password',
    passReqToCallback: true
}, async (req, username, password, done) => {
    console.log(req.body);
    const rows = await pool.query('SELECT * FROM operario WHERE username = ?', [username]);
    if (rows.length > 0) {
        const user = rows[0];
        const validPassword = await helpers.matchPassword(password, user.password);
        if (validPassword) {
            req.flash('success', '¡Bienvenido ' + user.username + '!');
            return done(null, user);
        } else {
            req.flash('error', 'Contraseña incorrecta');
            return done(null, false);
        }
    } else {
        req.flash('error', 'El usuario no existe');
        return done(null, false);
    }
}));

passport.use('local.signup', new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password',
    passReqToCallback: true
}, async (req, username, password, done) => {
    const { fullname, email, confirm_password } = req.body;

    try {
        // Verificar si el nombre de usuario ya existe
        const existingUser = await pool.query('SELECT * FROM operario WHERE username = ?', [username]);
        if (existingUser.length > 0) {
            req.flash('error', 'El nombre de usuario ya está en uso.');
            return done(null, false);
        }

        // Verificar si el email ya existe
        const existingEmail = await pool.query('SELECT * FROM operario WHERE email = ?', [email]);
        if (existingEmail.length > 0) {
            req.flash('error', 'El correo electrónico ya está registrado.');
            return done(null, false);
        }

        // Verificar si las contraseñas coinciden
        if (password !== confirm_password) {
            req.flash('error', 'Las contraseñas no coinciden.');
            return done(null, false);
        }

        // Asignar rol dependiendo del correo
        const role = email.endsWith('@cfmacrodent.com') ? 'admin' : 'user';

        // Crear el nuevo usuario
        const newUser = {
            username,
            password: await helpers.encryptPassword(password),
            fullname,
            email,
            role
        };

        const result = await pool.query('INSERT INTO operario SET ?', [newUser]);
        newUser.id_operario = result.insertId;

        return done(null, newUser);

    } catch (err) {
        console.error('Error en registro:', err);
        req.flash('error', 'Ocurrió un error al registrar el usuario.');
        return done(null, false);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id_operario);
});

passport.deserializeUser(async (id_operario, done) => {
    const rows = await pool.query('SELECT * FROM operario WHERE id_operario = ?', [id_operario]);
    done(null, rows[0]);
});