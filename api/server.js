const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Konfigurasi Environment Variables Vercel
// Ambil variabel lingkungan dari Vercel
const MONGODB_URI = process.env.MONGODB_URI || "KOSONG";

// KODE BARU: Pelacak Otomatis untuk mencetak apa yang dibaca Vercel di tab Logs
console.log("===[ DEBUG MONGO ]===");
console.log("15 Karakter Awal URI:", MONGODB_URI.substring(0, 15));
console.log("=====================");

if (MONGODB_URI === "KOSONG" || !MONGODB_URI.startsWith("mongodb")) {
  console.error("CRITICAL ERROR: Teks MONGODB_URI tidak valid atau kosong!");
}

// Lanjutkan koneksi ke mongoose
mongoose.connect(MONGODB_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("Koneksi gagal saat runtime:", err.message));
const JWT_SECRET = process.env.JWT_SECRET || "SUPER_RAHASIA_KUNCI_ECG_99";

mongoose.connect(MONGODB_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  pairedDeviceId: { type: String, default: null }
});

const LogSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true },
  role: { type: String, required: true },
  action: { type: String, enum: ['LOGIN', 'LOGOUT', 'STORING_DATA', 'DOWNLOAD_DATA'] },
  details: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Log = mongoose.model('Log', LogSchema);

// --- MIDDLEWARE PROTEKSI ---
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ success: false, error: "Akses ditolak." });
  try {
    const decoded = jwt.verify(token.split(" ")[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: "Sesi tidak valid." });
  }
};

// --- ENDPOINTS ---

// 1. SIGNUP API
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, error: "Email sudah terdaftar." });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // PENETAPAN ADMIN OTOMATIS BYPASS BY EMAIL
    let assignedRole = 'user';
    if (email.toLowerCase() === 'admin@ecg.com') {
      assignedRole = 'admin';
    }

    const newUser = new User({
      username,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: assignedRole
    });

    await newUser.save();
    res.json({ success: true, message: "Registrasi berhasil!" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Gagal menyimpan akun." });
  }
});

// 2. LOGIN API
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ success: false, error: "Akun tidak ditemukan." });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ success: false, error: "Password salah." });

    const token = jwt.sign({ id: user._id, role: user.role, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '2h' });

    // Catat Log Aktivitas Login ke MongoDB
    const newLog = new Log({
      username: user.username,
      email: user.email,
      role: user.role,
      action: 'LOGIN',
      details: `${user.username} masuk ke dalam sistem menggunakan browser.`
    });
    await newLog.save();

    res.json({
      success: true,
      token,
      user: { username: user.username, email: user.email, role: user.role, pairedDeviceId: user.pairedDeviceId }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Gagal memproses login." });
  }
});

// 3. LOG UTILITY API (Untuk Mencatat Aksi Storing & Download dari Web Frontend)
app.post('/api/log/activity', verifyToken, async (req, res) => {
  try {
    const { action, details } = req.body;
    const newLog = new Log({
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      action,
      details
    });
    await newLog.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 4. ADMIN: GET SEMUA AKUN & DEVICE PENGAWASAN
app.get('/api/admin/users', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: "Bukan area admin." });
  try {
    const users = await User.find({}, '-password');
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 5. ADMIN: PASANGKAN DEVICE ID KE USER
app.post('/api/admin/pair-device', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: "Bukan area admin." });
  try {
    const { userId, deviceId } = req.body;
    await User.findByIdAndUpdate(userId, { pairedDeviceId: deviceId || null });
    res.json({ success: true, message: "Device ID berhasil diperbarui." });
  } catch (err) {
    res.status(500).json({ success: false, error: "Gagal pairing device." });
  }
});

// 6. ADMIN: GET SELURUH LOG AKTIVITAS UNTUK MONITORING
app.get('/api/admin/logs', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: "Bukan area admin." });
  try {
    const logs = await Log.find().sort({ timestamp: -1 }).limit(100);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = app;