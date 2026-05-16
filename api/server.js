const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Hubungkan ke MongoDB Atlas via Environment Variable
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log("MongoDB Connection Error:", err));

// Skema User dengan enkripsi password satu arah
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// Endpoint Pendaftaran Akun (Sign Up)
app.post('/api/signup', async (req, res) => {
    try {
        const { email, username, password } = req.body;
        
        // Hash password menggunakan bcrypt sebelum disimpan
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ email, username, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ success: true, message: "Akun berhasil dibuat!" });
    } catch (err) {
        res.status(400).json({ success: false, error: "Email sudah terdaftar atau data tidak valid." });
    }
});

// Endpoint Masuk Akun (Login)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, error: "Email atau password salah." });

        // Verifikasi kecocokan hash password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, error: "Email atau password salah." });

        // Generate token sesi JWT yang aman
        const token = jwt.sign({ id: user._id, username: user.username }, 'rahasia_token_ecg', { expiresIn: '2h' });
        res.json({ success: true, token, user: { username: user.username, email: user.email } });
    } catch (err) {
        res.status(500).json({ success: false, error: "Terjadi kesalahan pada server." });
    }
});

module.exports = app;