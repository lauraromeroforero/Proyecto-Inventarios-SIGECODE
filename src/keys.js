const { DB_USER, DB_PASSWORD, DB_HOST, DB_DATABASE, DB_PORT } = require('./config.js');
module.exports={
    database: {
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASSWORD,
        port: DB_PORT,
        database: DB_DATABASE
    }
}