import jwt from 'jsonwebtoken';

export const AuthTokenResponse = ({ userId, res }) => {
  try {
    const token = jwt.sign({ userId }, process.env.SECRET_TOKEN_KEY, {
      expiresIn: '7d',
    });

    // Send token in response body instead of cookie
    return res.status(200).json({ token });
    
  } catch (error) {
    console.error('AuthTokenResponse error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
