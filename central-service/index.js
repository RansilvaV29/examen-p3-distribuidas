const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');


const app = express();
app.use(express.json());

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'agroflow',
    password: process.env.DB_PASSWORD || 'admin',
    port: process.env.DB_PORT || 5432,
});

// Set schema to 'central' and wait for it to complete
async function initializeDatabase() {
    try {
        await pool.query('SET search_path TO central');
        console.log('Database schema set to central');
        
        // Verify tables exist
        const tablesCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'central' 
            AND table_name IN ('agricultores', 'cosechas')
        `);
        
        if (tablesCheck.rows.length === 2) {
            console.log('✅ All required tables exist in central schema');
        } else {
            console.log('❌ Missing tables in central schema:', tablesCheck.rows);
        }
    } catch (error) {
        console.error('Error setting schema:', error);
    }
}

initializeDatabase();

// Connect to RabbitMQ
async function connectRabbitMQ() {
    const conn = await amqp.connect({
        protocol: 'amqp',
        hostname: process.env.RABBITMQ_HOST || 'localhost',
        port: process.env.RABBITMQ_PORT || 5672,
        username: process.env.RABBITMQ_USER || 'admin',
        password: process.env.RABBITMQ_PASSWORD || 'admin'
    });
    const channel = await conn.createChannel();
    await channel.assertQueue('harvest_queue');
    await channel.assertQueue('inventory_queue');
    return channel;
}

// Registrar nuevo agricultor (solo uuid_id y nombre)
app.post('/agricultores', async (req, res) => {
    const { nombre } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }

    try {
        const uuid_id = uuidv4();

        const result = await pool.query(
            'INSERT INTO central.agricultores (uuid_id, nombre) VALUES ($1, $2) RETURNING uuid_id, nombre',
            [uuid_id, nombre]
        );

        res.status(201).json({
            message: 'Agricultor registrado correctamente',
            agricultor: result.rows[0]
        });
    } catch (error) {
        console.error('Error al registrar agricultor:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Listar todos los agricultores
app.get('/agricultores', async (req, res) => {
    try {
        const result = await pool.query('SELECT uuid_id, nombre FROM central.agricultores ORDER BY nombre');
        res.json(result.rows);
    } catch (error) {
        console.error('Error al listar agricultores:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});


// API to register a new harvest
app.post('/cosechas', async (req, res) => {
    const { agricultor_id, producto, toneladas, ubicacion } = req.body;

    // Validar producto permitido
    const productosPermitidos = ['maiz', 'arroz', 'trigo'];
    if (!agricultor_id || !producto || toneladas <= 0 || !ubicacion) {
        return res.status(400).json({ error: 'Invalid input' });
    }
    if (!productosPermitidos.includes(producto)) {
        return res.status(400).json({ error: 'Solo se permiten los productos: maiz, arroz y trigo si tiene mas productos contacte cpmn el administrador' });
    }

    try {
        // Verify farmer exists (now using uuid_id)
        const farmer = await pool.query('SELECT * FROM central.agricultores WHERE uuid_id = $1', [agricultor_id]);
        if (farmer.rows.length === 0) {
            return res.status(404).json({ error: 'Farmer not found' });
        }

        // Insert harvest (let database generate auto-increment ID)
        const result = await pool.query(
            'INSERT INTO central.cosechas (agricultor_id, agricultor_uuid, producto, toneladas, estado, fecha) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, uuid_id',
            [farmer.rows[0].id, agricultor_id, producto, toneladas, 'REGISTRADA']
        );
        
        const harvestId = result.rows[0].id;
        const harvestUuid = result.rows[0].uuid_id;

        // Publish event to RabbitMQ
        const channel = await connectRabbitMQ();
        const message = JSON.stringify({ harvestId, harvestUuid, producto, toneladas });
        channel.sendToQueue('harvest_queue', Buffer.from(message));
        channel.sendToQueue('inventory_queue', Buffer.from(message));

        res.status(201).json({ 
            message: 'Harvest registered', 
            harvestId: harvestId,
            harvestUuid: harvestUuid
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update harvest status
app.put('/cosechas/:id/estado', async (req, res) => {
    const { id } = req.params;
    const { estado, factura_id, factura_uuid } = req.body;

    try {
        // Update using either numeric ID or UUID
        let query, params, cosechaQuery, cosechaParams;
        if (isNaN(id)) {
            // UUID provided
            query = 'UPDATE central.cosechas SET estado = $1, factura_id = $2, factura_uuid = $3 WHERE uuid_id = $4';
            params = [estado, factura_id, factura_uuid, id];
            cosechaQuery = 'SELECT producto, toneladas, factura_id FROM central.cosechas WHERE uuid_id = $1';
            cosechaParams = [id];
        } else {
            // Numeric ID provided
            query = 'UPDATE central.cosechas SET estado = $1, factura_id = $2, factura_uuid = $3 WHERE id = $4';
            params = [estado, factura_id, factura_uuid, parseInt(id)];
            cosechaQuery = 'SELECT producto, toneladas, factura_id FROM central.cosechas WHERE id = $1';
            cosechaParams = [parseInt(id)];
        }

        await pool.query(query, params);

        // Si se asignó factura, emitir alerta
        if (factura_id) {
            const cosecha = await pool.query(cosechaQuery, cosechaParams);
            if (cosecha.rows.length > 0) {
                const { producto, toneladas } = cosecha.rows[0];
                // Formato: "Cosecharegistrada: 12.5tArroz Oro.Factura #F-2024-089pendiente depago"
                console.log(`Cosecharegistrada: ${toneladas}t${producto}.Factura #${factura_id}pendiente depago`);
            }
        }

        res.json({ message: 'Harvest status updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.listen(3000, () => console.log('Central service running on port 3000'));