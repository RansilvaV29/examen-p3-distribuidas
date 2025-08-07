const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
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

// Set schema to 'inventory' and wait for it to complete
async function initializeDatabase() {
    try {
        await pool.query('SET search_path TO inventory');
        console.log('Database schema set to inventory');
        
        // Verify tables exist
        const tablesCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'inventory' 
            AND table_name = 'insumos'
        `);
        
        if (tablesCheck.rows.length === 1) {
            console.log('✅ All required tables exist in inventory schema');
        } else {
            console.log('❌ Missing tables in inventory schema:', tablesCheck.rows);
        }
    } catch (error) {
        console.error('Error setting schema:', error);
    }
}

initializeDatabase();

// GET endpoint to retrieve all insumos
app.get('/insumos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inventory.insumos ORDER BY id');
        res.json({
            message: 'Insumos retrieved successfully',
            data: result.rows
        });
    } catch (error) {
        console.error('Error retrieving insumos:', error);
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
    await channel.assertQueue('inventory_queue');

    channel.consume('inventory_queue', async (msg) => {
        const { harvestId, harvestUuid, producto, toneladas } = JSON.parse(msg.content.toString());

        // Definición de insumos
        const insumoFertilizante = 'Fertilizante N-P-K';
        const insumoSemillas = 'Semillas de Maiz';
        const insumoPesticida = 'Pesticida Organico';
        const insumoAgua = 'Agua de Riego';

        try {
            let updates = [];
            if (producto === 'maiz') {
                // Maíz: Fertilizante, Semillas, Agua, Pesticida
                updates.push({ nombre: insumoFertilizante, cantidad: toneladas * 2 }); // 2 fertilizante por tonelada
                updates.push({ nombre: insumoSemillas, cantidad: toneladas * 1 }); // 1 semillas por tonelada
                updates.push({ nombre: insumoAgua, cantidad: toneladas * 10 }); // 10 agua por tonelada
                updates.push({ nombre: insumoPesticida, cantidad: toneladas * 0.5 }); // 0.5 pesticida por tonelada
            } else if (producto === 'arroz') {
                // Arroz: Fertilizante, Agua, Pesticida
                updates.push({ nombre: insumoFertilizante, cantidad: toneladas * 1.5 }); // 1.5 fertilizante por tonelada
                updates.push({ nombre: insumoAgua, cantidad: toneladas * 15 }); // 15 agua por tonelada
                updates.push({ nombre: insumoPesticida, cantidad: toneladas * 0.7 }); // 0.7 pesticida por tonelada
            } else if (producto === 'trigo') {
                // Trigo: Fertilizante, Agua, Pesticida
                updates.push({ nombre: insumoFertilizante, cantidad: toneladas * 1.2 }); // 1.2 fertilizante por tonelada
                updates.push({ nombre: insumoAgua, cantidad: toneladas * 8 }); // 8 agua por tonelada
                updates.push({ nombre: insumoPesticida, cantidad: toneladas * 0.3 }); // 0.3 pesticida por tonelada
            } else {
                console.log(`Producto no reconocido: ${producto}`);
                channel.ack(msg);
                return;
            }

            for (const upd of updates) {
                const result = await pool.query(
                    'UPDATE inventory.insumos SET stock = stock - $1 WHERE nombre = $2 RETURNING *',
                    [upd.cantidad, upd.nombre]
                );
                if (result.rows.length > 0) {
                    console.log(`Stock updated for ${upd.nombre} (harvest ${harvestId}) - New stock: ${result.rows[0].stock}`);
                } else {
                    console.log(`Warning: ${upd.nombre} not found in inventory`);
                }
            }
            channel.ack(msg);
        } catch (error) {
            console.error('Error updating stock:', error);
            channel.nack(msg);
        }
    });
}

consumeHarvestEvents().catch(console.error);

app.listen(3001, () => console.log('Inventory service running on port 3001'));