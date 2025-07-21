import express from 'express';
import dotenv from 'dotenv';
import mongoDB from './db/mongoose.js';
import { AuthRouter } from './routes/auth.route.js';
import fileUpload from 'express-fileupload';
import cookieParser from 'cookie-parser';
import cors from 'cors'
dotenv.config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 3000; // Fallback port if .env is missing
app.use(express.json())
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/' // or any temp directory you want
}));
app.use(cookieParser())

app.get('/', (req, res) => {
  res.send("hello)
});

mongoDB()

app.use('/auth',AuthRouter)
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
