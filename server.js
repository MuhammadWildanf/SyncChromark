const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Pastikan folder public/uploads ada
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');
const DIVISIONS_FILE = path.join(__dirname, 'divisions.json');

// Memuat data divisi dari file divisions.json jika ada, atau buat default jika tidak ada
let allDivisions = [];
if (fs.existsSync(DIVISIONS_FILE)) {
    try {
        allDivisions = JSON.parse(fs.readFileSync(DIVISIONS_FILE, 'utf8'));
        console.log(`Loaded ${allDivisions.length} divisions from file.`);
    } catch (err) {
        console.error('Error reading divisions file:', err);
        allDivisions = ["IT", "HRD", "Marketing", "Operasional", "Finance"];
    }
} else {
    allDivisions = ["IT", "HRD", "Marketing", "Operasional", "Finance"];
    try {
        fs.writeFileSync(DIVISIONS_FILE, JSON.stringify(allDivisions, null, 2), 'utf8');
        console.log('Created default divisions.json');
    } catch (err) {
        console.error('Error writing default divisions:', err);
    }
}

// Memuat data dari file submissions.json jika ada, atau buat baru jika tidak ada
let allSubmissions = [];
if (fs.existsSync(SUBMISSIONS_FILE)) {
    try {
        const fileContent = fs.readFileSync(SUBMISSIONS_FILE, 'utf8');
        allSubmissions = JSON.parse(fileContent);
        console.log(`Loaded ${allSubmissions.length} submissions from file.`);
    } catch (err) {
        console.error('Error reading submissions file:', err);
    }
}

// Memory cache untuk menyimpan data antrean foto terakhir (misal 50 foto terakhir)
// Berfungsi untuk sinkronisasi cepat jika Unity sempat terputus
let recentSubmissions = allSubmissions.slice(-50);
const MAX_CACHE_SIZE = 50;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// WebSocket connection
wss.on('connection', (ws) => {
    console.log('Unity/Client connected');
    ws.send(JSON.stringify({ type: 'WELCOME', message: 'Connected to server' }));

    ws.on('message', (message) => {
        console.log(`Received message => ${message}`);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Broadcast function
function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Disguised Routes (Now pointing to Login page first)
// Endpoint 1: bod (Disguised as /7a2b)
app.get('/7a2b', (req, res) => {
    res.render('login', { type: 'bod', title: 'Login Board of Directors' });
});

// Endpoint 2: staf (Disguised as /9f4c)
app.get('/9f4c', (req, res) => {
    res.render('login', { type: 'staf', title: 'Login Staf' });
});

// Route: Manual Registration Form
app.get('/form', (req, res) => {
    const { type } = req.query;
    res.render('form', { type: type || 'staf', title: 'Registrasi Mandiri', divisions: allDivisions });
});

// Route: Personal QR Code Check-in (Bypass all forms, directly open selfie camera)
app.get('/checkin', (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.redirect('/');
    }

    try {
        const USERS_FILE = path.join(__dirname, 'users.json');
        if (!fs.existsSync(USERS_FILE)) {
            return res.status(500).send('Database tamu tidak ditemukan di server.');
        }

        const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        const user = usersData.find(u => u.code.toLowerCase() === code.trim().toLowerCase());

        if (!user) {
            return res.status(404).send('Kode tamu tidak valid atau tidak terdaftar.');
        }

        // Tentukan tipe kategori (undangan -> bod, guest -> staf)
        const userType = user.type === 'undangan' ? 'bod' : 'staf';
        
        let userDivision = user.division;
        if (userType === 'bod' && (!userDivision || userDivision.toLowerCase() === 'it' || userDivision.toLowerCase() === 'hr' || userDivision.toLowerCase() === 'marketing' || userDivision.toLowerCase() === 'operasional' || userDivision.toLowerCase() === 'finance')) {
            userDivision = 'Board of Directors';
        }

        // Redirect langsung ke halaman selfie dengan pre-filled data
        res.redirect(`/selfie?name=${encodeURIComponent(user.name)}&division=${encodeURIComponent(userDivision || 'Board of Directors')}&type=${userType}`);
    } catch (err) {
        console.error('Error on personal QR check-in:', err);
        res.status(500).send('Terjadi kesalahan saat memproses check-in.');
    }
});

// Fallback to home or redirect
app.get('/', (req, res) => {
    res.send('Akses ditolak.');
});

// Route: Selfie Page
app.get('/selfie', (req, res) => {
    const { name, division, type } = req.query;
    res.render('selfie', { name, division, type });
});

// Route: Admin Dashboard
app.get('/admin', (req, res) => {
    res.render('admin', { submissions: allSubmissions, title: 'Dashboard Admin | SynchroMark', divisions: allDivisions });
});

// API: Dapatkan foto-foto terakhir (Untuk cadangan/sinkronisasi Unity jika disconnect)
app.get('/api/recent-photos', (req, res) => {
    res.json({ success: true, submissions: recentSubmissions });
});

// API: Verifikasi Kode Akses dari users.json
app.post('/api/verify-code', (req, res) => {
    const { code, type } = req.body;

    if (!code) {
        return res.status(400).json({ success: false, message: 'Kode akses diperlukan.' });
    }

    try {
        const USERS_FILE = path.join(__dirname, 'users.json');
        if (!fs.existsSync(USERS_FILE)) {
            return res.status(500).json({ success: false, message: 'Database user tidak ditemukan di server.' });
        }

        const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        
        // Cari user dengan kode yang cocok (case-insensitive)
        const user = usersData.find(u => u.code.toLowerCase() === code.trim().toLowerCase());

        if (!user) {
            return res.status(404).json({ success: false, message: 'Kode akses salah atau tidak ditemukan.' });
        }

        // Jika user adalah undangan (BOD), pastikan divisionnya diisi "Board of Directors" jika tidak ada
        let userDivision = user.division;
        if (type === 'bod' && (!userDivision || userDivision.toLowerCase() === 'it' || userDivision.toLowerCase() === 'hr' || userDivision.toLowerCase() === 'marketing' || userDivision.toLowerCase() === 'operasional' || userDivision.toLowerCase() === 'finance')) {
            userDivision = 'Board of Directors';
        }

        res.json({
            success: true,
            message: 'Kode berhasil diverifikasi.',
            user: {
                code: user.code,
                name: user.name,
                division: userDivision || (type === 'bod' ? 'Board of Directors' : 'Umum')
            }
        });
    } catch (err) {
        console.error('Error verifying code:', err);
        res.status(500).json({ success: false, message: 'Gagal memproses verifikasi di server.' });
    }
});

// API: Submit Data
app.post('/api/submit', (req, res) => {
    const { name, division, type, image } = req.body;

    try {
        // Konversi base64 ke file jpg fisik di server
        const base64Data = image.replace(/^data:image\/jpeg;base64,/, "");
        const filename = `selfie_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
        const filepath = path.join(UPLOADS_DIR, filename);

        fs.writeFileSync(filepath, base64Data, 'base64');
        console.log(`Saved file: ${filename}`);

        // Buat URL publik untuk foto tersebut
        // Menggunakan relative path agar fleksibel dengan domain/IP apa saja
        const imageUrl = `/uploads/${filename}`;

        const newSubmission = {
            id: Date.now(),
            name,
            division,
            userType: type,
            imageUrl: imageUrl, // Path relatif untuk didownload Unity
            timestamp: new Date().toISOString()
        };

        // Simpan ke database file submissions.json secara persistent
        allSubmissions.push(newSubmission);
        try {
            fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(allSubmissions, null, 2), 'utf8');
            console.log(`Saved new submission to ${SUBMISSIONS_FILE}`);
        } catch (err) {
            console.error('Error writing submissions file:', err);
        }

        // Simpan ke memory cache cadangan
        recentSubmissions.push(newSubmission);
        if (recentSubmissions.length > MAX_CACHE_SIZE) {
            recentSubmissions.shift(); // Hapus yang paling lama jika cache penuh
        }

        // Data to send to Unity (Termasuk URL file fisik dan cadangan base64 jika dibutuhkan)
        const dataToUnity = {
            type: 'USER_SUBMITTED',
            user: {
                name,
                division,
                userType: type
            },
            imageUrl: imageUrl, // Unity bisa download file aslinya dari link ini
            image: image // Tetap sertakan base64 untuk render instan jika disukai
        };

        // Broadcast real-time ke Unity
        broadcast(dataToUnity);

        res.json({ success: true, message: 'Data berhasil disimpan dan dikirim ke Unity' });

    } catch (error) {
        console.error('Error saving image:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan gambar di server' });
    }
});

// API: Hapus data pendaftaran oleh Admin
app.delete('/api/submissions/:id', (req, res) => {
    const { id } = req.params;

    try {
        const submissionId = parseInt(id);

        // Cari index item di memory allSubmissions
        const index = allSubmissions.findIndex(sub => sub.id === submissionId);

        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Data tidak ditemukan.' });
        }

        // Hapus file fisik gambar jika ada
        const submission = allSubmissions[index];
        if (submission.imageUrl) {
            const filepath = path.join(__dirname, 'public', submission.imageUrl);
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
                console.log(`Deleted physical image file: ${filepath}`);
            }
        }

        // Hapus dari memory array
        allSubmissions.splice(index, 1);

        // Tulis ulang database file submissions.json secara persistent
        fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(allSubmissions, null, 2), 'utf8');
        console.log(`Deleted submission ID ${id} from submissions.json`);

        // Hapus juga dari memory cache recentSubmissions
        recentSubmissions = allSubmissions.slice(-MAX_CACHE_SIZE);

        res.json({ success: true, message: 'Data pendaftaran berhasil dihapus.' });

    } catch (error) {
        console.error('Error deleting submission:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus data di server.' });
    }
});

// API: Dapatkan semua daftar divisi
app.get('/api/divisions', (req, res) => {
    res.json({ success: true, divisions: allDivisions });
});

// API: Tambah divisi baru
app.post('/api/divisions', (req, res) => {
    const { name } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Nama divisi tidak boleh kosong.' });
    }

    const trimmedName = name.trim();

    // Cek apakah divisi sudah terdaftar
    if (allDivisions.some(div => div.toLowerCase() === trimmedName.toLowerCase())) {
        return res.status(400).json({ success: false, message: 'Divisi sudah ada.' });
    }

    try {
        allDivisions.push(trimmedName);
        fs.writeFileSync(DIVISIONS_FILE, JSON.stringify(allDivisions, null, 2), 'utf8');
        console.log(`Added new division: ${trimmedName}`);
        res.json({ success: true, message: 'Divisi berhasil ditambahkan.', divisions: allDivisions });
    } catch (err) {
        console.error('Error adding division:', err);
        res.status(500).json({ success: false, message: 'Gagal menyimpan divisi di server.' });
    }
});

// API: Hapus divisi
app.delete('/api/divisions/:name', (req, res) => {
    const { name } = req.params;

    if (!name) {
        return res.status(400).json({ success: false, message: 'Nama divisi tidak valid.' });
    }

    const trimmedName = name.trim();

    // Cek apakah divisi ada
    const index = allDivisions.findIndex(div => div.toLowerCase() === trimmedName.toLowerCase());
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Divisi tidak ditemukan.' });
    }

    try {
        allDivisions.splice(index, 1);
        fs.writeFileSync(DIVISIONS_FILE, JSON.stringify(allDivisions, null, 2), 'utf8');
        console.log(`Deleted division: ${trimmedName}`);
        res.json({ success: true, message: 'Divisi berhasil dihapus.', divisions: allDivisions });
    } catch (err) {
        console.error('Error deleting division:', err);
        res.status(500).json({ success: false, message: 'Gagal menghapus divisi di server.' });
    }
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
