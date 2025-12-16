create database control_inventarios;
use control_inventarios;

create table operario (
    id_operario INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    fullname VARCHAR(100) NOT NULL,
    password VARCHAR(200) NOT NULL,
    role ENUM('admin', 'user') NOT NULL DEFAULT 'user'  -- Aquí hemos añadido la columna role
);

CREATE TABLE productos (
    id_productos INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    codigo_barras VARCHAR(100) NOT NULL UNIQUE,
    presentacion VARCHAR(100) NOT NULL,
    tamano VARCHAR(100) NOT NULL,
    color VARCHAR(50) NOT NULL,
    reg_invima VARCHAR(100) NOT NULL,
    proovedor VARCHAR(100) NOT NULL,
    descripcion VARCHAR(200),
    stock_minimo INT NOT NULL,
    img LONGBLOB,
    id_operario INT,
    FOREIGN KEY (id_operario) REFERENCES operario(id_operario)
);

CREATE TABLE lotes_productos (
    id_lote INT AUTO_INCREMENT PRIMARY KEY,
    id_productos INT NOT NULL,
    nro_lote VARCHAR(100) NOT NULL,
    cantidad INT NOT NULL,
    fecha_ingreso TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento DATE,
    FOREIGN KEY (id_productos) REFERENCES productos(id_productos)
);

create table historial_productos (
    id_historial INT AUTO_INCREMENT PRIMARY KEY,
    id_productos INT NOT NULL,
    accion VARCHAR(50) NOT NULL,       -- Acciones como "editar" o "eliminar"
    mensaje TEXT NOT NULL,             -- Descripción de la acción
    id_operario INT NOT NULL,          -- ID del operario o usuario
    nombre_operario VARCHAR(255) NOT NULL,  -- Nombre del operario
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Fecha y hora de la acción
);

-- Tabla de remisiones (encabezado)
CREATE TABLE remision (
    id_remision INT AUTO_INCREMENT PRIMARY KEY,
    fecha_remision TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    creado_por INT NOT NULL,
    FOREIGN KEY (creado_por) REFERENCES operario(id_operario)
);

-- Detalle de cada producto incluido en una remisión
CREATE TABLE detalle_remision (
    id_detalle INT AUTO_INCREMENT PRIMARY KEY,
    id_remision INT NOT NULL,
    id_productos INT NOT NULL,
    nro_lote VARCHAR(100) NOT NULL,
    cantidad INT NOT NULL,
    FOREIGN KEY (id_remision) REFERENCES remision(id_remision),
    FOREIGN KEY (id_productos) REFERENCES productos(id_productos)
);

-- Carrito temporal para preparar una remisión
CREATE TABLE carrito_remision (
    id_carrito INT AUTO_INCREMENT PRIMARY KEY,
    id_operario INT NOT NULL,
    id_productos INT NOT NULL,
    cantidad INT NOT NULL,
    nro_lote VARCHAR(50),
    FOREIGN KEY (id_operario) REFERENCES operario(id_operario),
    FOREIGN KEY (id_productos) REFERENCES productos(id_productos)
);

SELECT COUNT(*) FROM productos;