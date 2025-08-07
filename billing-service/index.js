const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'agroflow',
    password: process.env.DB_PASSWORD || 'admin',
    port: process.env.DB_PORT || 5432,
});

// Set schema to 'billing' and wait for it to complete
async function initializeDatabase() {
    try {
        await pool.query('SET search_path TO billing');
        console.log('Database schema set to billing');
        
        // Verify tables exist
        const tablesCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'billing' 
            AND table_name = 'facturas'
        `);
        
        if (tablesCheck.rows.length === 1) {
            console.log('✅ All required tables exist in billing schema');
        } else {
            console.log('❌ Missing tables in billing schema:', tablesCheck.rows);
        }
    } catch (error) {
        console.error('Error setting schema:', error);
    }
}

initializeDatabase();

// GET endpoint to retrieve all facturas
app.get('/facturas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM billing.facturas ORDER BY id');
        res.json({
            message: 'Facturas retrieved successfully',
            data: result.rows
        });
    } catch (error) {
        console.error('Error retrieving facturas:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Consume harvest events from RabbitMQ
async function consumeHarvestEvents() {
    const conn = await amqp.connect({
        protocol: 'amqp',
        hostname: process.env.RABBITMQ_HOST || 'localhost',
        port: process.env.RABBITMQ_PORT || 5672,
        username: process.env.RABBITMQ_USER || 'admin',
        password: process.env.RABBITMQ_PASSWORD || 'admin'
    });
    const channel = await conn.createChannel();
    await channel.assertQueue('harvest_queue');

    channel.consume('', async (msg) => {
        const { harvestId, harvestUuid, producto, toneladas } = JSON.parse(msg.content.toString());

        if (producto == "arroz"){
            precio = 1000;
        }else if (producto == "maiz"){
            precio = 800;
        }
        else if (producto == "trigo"){
            precio = 600;
        }

        try {
            const monto = toneladas * precio;

            // Persist invoice (let database generate auto-increment ID)
            const result = await pool.query(
                'INSERT INTO billing.facturas (cosecha_id, cosecha_uuid, monto, pagada) VALUES ($1, $2, $3, $4) RETURNING id, uuid_id', 
                [harvestId, harvestUuid, monto, false]
            );
            
            const facturaId = result.rows[0].id;
            const facturaUuid = result.rows[0].uuid_id;

            // Emitir alerta en consola con formato solicitado
            // Ejemplo: Cosecharegistrada: 12.5tArroz Oro.Factura #F-2024-089pendiente depago
            let nombreProducto = producto.charAt(0).toUpperCase() + producto.slice(1);
            console.log(`Cosecharegistrada: ${toneladas}t${nombreProducto}.Factura #${facturaId}pendiente depago`);

            // Notify Central service
            await axios.put(`${process.env.CENTRAL_SERVICE_URL || 'http://localhost:3000'}/cosechas/${harvestId}/estado`, {
                estado: 'FACTURADA',
                factura_id: facturaId,
                factura_uuid: facturaUuid,
            });

            console.log(`Invoice generated for harvest ${harvestId} - Invoice ID: ${facturaId}`);
            channel.ack(msg);
        } catch (error) {
            console.error('Error generating invoice:', error);
            channel.nack(msg);
        }
    });
}

consumeHarvestEvents().catch(console.error);

app.listen(3002, () => console.log('Billing service running on port 3002'));