module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }
  
  // In a real app, verify the JWT token here
  // For now, we'll just check if it exists
  next();
};