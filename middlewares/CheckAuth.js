import jwt from 'jsonwebtoken';
import { User } from '../models/auth.model.js';

export const CheckAuth = async (req, res, next) => {
  try {
    // ✅ Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Authorization token missing or malformed" });
    }

    const token = authHeader.split(' ')[1];

    // ✅ Verify JWT token
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Attach user to request
    req.user = findUser;

    next();
  } catch (error) {
    console.error("CheckAuth error:", error);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
