-- Create the agroflow database
-- CREATE DATABASE agroflow;

-- Connect to the agroflow database
\c agroflow

-- Drop existing schemas and recreate (for development only)
DROP SCHEMA IF EXISTS central CASCADE;
DROP SCHEMA IF EXISTS inventory CASCADE;
DROP SCHEMA IF EXISTS billing CASCADE;

-- Create schemas
CREATE SCHEMA central;
CREATE SCHEMA inventory;
CREATE SCHEMA billing;

-- Central schema tables
CREATE TABLE central.agricultores (
    id SERIAL PRIMARY KEY,
    uuid_id UUID UNIQUE DEFAULT gen_random_uuid(),
    nombre VARCHAR(100)
);

CREATE TABLE central.cosechas (
    id SERIAL PRIMARY KEY,
    uuid_id UUID UNIQUE DEFAULT gen_random_uuid(),
    agricultor_id INTEGER REFERENCES central.agricultores(id),
    agricultor_uuid UUID,
    producto VARCHAR(50),
    toneladas FLOAT,
    estado VARCHAR(20),
    factura_id INTEGER,
    factura_uuid UUID,
    fecha TIMESTAMP DEFAULT NOW()
);

-- Inventory schema table
CREATE TABLE inventory.insumos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE,
    stock FLOAT DEFAULT 0,
    descripcion TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Billing schema table
CREATE TABLE billing.facturas (
    id SERIAL PRIMARY KEY,
    uuid_id UUID UNIQUE DEFAULT gen_random_uuid(),
    cosecha_id INTEGER,
    cosecha_uuid UUID,
    monto FLOAT,
    pagada BOOLEAN DEFAULT FALSE,
    fecha_emision TIMESTAMP DEFAULT NOW(),
    fecha_pago TIMESTAMP
);

-- Insert initial data for testing
INSERT INTO central.agricultores (uuid_id, nombre) VALUES ('d3b8f7a0-4f5d-11e8-bd5a-02a2a1c12002', 'Test Farmer');
INSERT INTO central.agricultores (nombre) VALUES ('Juan Perez');
INSERT INTO central.agricultores (nombre) VALUES ('Maria Gonzalez');

INSERT INTO inventory.insumos (nombre, stock, descripcion) VALUES 
    ('Fertilizante N-P-K', 1000, 'Fertilizante balanceado de nitrógeno, fósforo y potasio'),
    ('Semillas de Maiz', 500, 'Semillas hibridas de maíz alta productividad'),
    ('Pesticida Organico', 200, 'Pesticida orgánico biodegradable'),
    ('Agua de Riego', 10000, 'Agua tratada para riego en litros');
