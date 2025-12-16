const express = require('express');
const morgan = require('morgan');
const exphbs = require('express-handlebars');
const path = require('path');
const flash = require('connect-flash');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const passport = require('passport');

const {database} = require('./keys');

const {PORT} = require('./config');
// inicialización
const app = express();
require('./lib/passport');

// ajustes
app.set('port', process.env.PORT || 5000);
app.set('views', path.join(__dirname, 'views'))
app.engine('.hbs', exphbs.engine({
    defaultLayout: 'main',
    layoutsDir: path.join(app.get('views'), 'layouts'),
    partialsDir: path.join(app.get('views'), 'partials'),
    extname: '.hbs',
    helpers: require('./lib/handlebars')
}));
app.set('view engine', 'hbs');

const sessionStore = new MySQLStore(database);

// middlewares
app.use(session({
    secret: 'inventarioproductos',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
}));
app.use(flash());
app.use(morgan('dev'));
app.use(express.urlencoded({extended: false}));
app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
    app.locals.success = req.flash('success');
    app.locals.warning = req.flash('warning');
    app.locals.error = req.flash('error');
    app.locals.user = req.user;
    next();
});

// variables goblales

// rutas
app.use(require('./routes'));
app.use(require('./routes/authentication'));
app.use('/products', require('./routes/products'));
app.use('/products', require('./routes/lotes'));
app.use('/products', require('./routes/remision'));
app.use('/products', require('./routes/escaner'));
app.use('/products', require('./routes/historial'));

// publico
app.use(express.static(path.join(__dirname, 'public')));

// empezando el servidor
app.listen(app.get('port'), () =>{
    console.log('Server on port', app.get('port'));
})