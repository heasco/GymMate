const errorHandler = (err, req, res, next) => {
  // Log to console for dev
  console.error(err.stack.red);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'Resource not found'
    });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    return res.status(400).json({
      success: false,
      error: messages
    });
  }

  // Default server error
  res.status(500).json({
    success: false,
    error: 'Server Error'
  });
};

module.exports = errorHandler;