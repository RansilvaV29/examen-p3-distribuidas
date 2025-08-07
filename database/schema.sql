-- Create the agroflow database
-- CREATE DATABASE agroflow;

-- Connect to the agroflow database
\c agroflow

-- Create schemas
CREATE SCHEMA central;
CREATE SCHEMA inventory;
CREATE SCHEMA billing;

-- Central schema tables
CREATE TABLE central.agricultores (
    id UUID PRIMARY KEY,
    nombre VARCHAR(100)
);

CREATE TABLE central.cosechas (
    id UUID PRIMARY KEY,
    agricultor_id UUID REFERENCES central.agricultores(id),
    producto VARCHAR(50),
    toneladas FLOAT,
    estado VARCHAR(20),
    factura_id UUID,
    fecha TIMESTAMP
);

-- Inventory schema table
CREATE TABLE inventory.insumos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50),
    stock FLOAT
);

-- Billing schema table
CREATE TABLE billing.facturas (
    id UUID PRIMARY KEY,
    cosecha_id UUID,
    monto FLOAT,
    pagada BOOLEAN
);

-- Insert initial data for testing
INSERT INTO central.agricultores (id, nombre) VALUES ('d3b8f7a0-4f5d-11e8-bd5a-02a2a1c12002', 'Test Farmer');
INSERT INTO inventory.insumos (nombre, stock) VALUES ('Fertilizante N-P-K', 1000);