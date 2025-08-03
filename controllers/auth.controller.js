
import { User } from '../models/auth.model.js'; // adjust the path if needed
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import jwt from 'jsonwebtoken';
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});

export const UpdateProfile = async (req, res) => {
  try {
    // Extract token from header
    const {token} = req.params // e.g., Bearer <token>

    if (!token) {
      return res.status(401).json({ message: "Token missing" });
    }

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select("-password");
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const { username, password } = req.body;

    // Update username if provided
    if (username) {
      findUser.username = username;
    }

    // Update password securely
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      findUser.password = hashedPassword;
    }

    // Update profile photo if provided
    if (req.files?.photo) {
      const photo = req.files.photo;
      const uploadPhoto = await cloudinary.uploader.upload(photo.tempFilePath);
      findUser.image = uploadPhoto.secure_url;
    }

    await findUser.save();
    return res.status(200).json({ message: "Profile updated successfully" });

  } catch (error) {
    console.log("❌ UpdateProfile error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Basic validation
    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(409).json({ message: "User with that email or username already exists" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      ipAddress: [
        {
          latestIP: clientIP,
          oldIP: '',
          loginDate: new Date()
        }
      ],
      oldPassword: [
        {
          password: hashedPassword,
          passwordDate: new Date()
        }
      ],
      lastLogin: new Date()
    });

    await newUser.save();

    // ✅ Generate token instead of cookie
    const token = jwt.sign({ userId: newUser._id }, process.env.SECRET_TOKEN_KEY, {
      expiresIn: '7d',
    });

    // ✅ Return token in response (mobile-friendly)
    return res.status(201).json({
      message: "User registered successfully",
      userId: newUser._id,
      token, // <--- Mobile app will save this in AsyncStorage
    });

  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



const loginAttempts = {}; // In-memory store

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Rate Limiting by IP
    const now = Date.now();
    const attempts = loginAttempts[clientIP] || [];
    const recentAttempts = attempts.filter((time) => now - time < 60 * 1000); // last 60s

    if (recentAttempts.length >= 4) {
      return res.status(429).json({ message: "Too many attempts. Please try again after 60 seconds." });
    }

    loginAttempts[clientIP] = [...recentAttempts, now];

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Add IP to history
    user.ipAddress.unshift({
      latestIP: clientIP,
      oldIP: user.ipAddress[0]?.latestIP || '',
      loginDate: new Date(),
    });

    // Update lastLogin
    user.lastLogin = new Date();

    await user.save();

    // ✅ Generate token instead of using cookie
    const token = jwt.sign({ userId: user._id }, process.env.SECRET_TOKEN_KEY, {
      expiresIn: '7d',
    });

    return res.status(200).json({
      message: "Login successful",
      userId: user._id,
      role: user.role,
      token, // ← frontend will store this
    });

  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



export const Profile = async (req, res) => {
  try {
    const token = req.params.token; // ✅ correctly access token

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Profile fetched successfully",
      findUser,
    });

  } catch (error) {
    console.error("Profile error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

