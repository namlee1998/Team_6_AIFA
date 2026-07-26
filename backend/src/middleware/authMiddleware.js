const authMiddleware = async (req, res, next) => {
  // Authentication bypassed for local execution
  req.user = {
    id: 'local-user-id',
    email: 'local-user@example.com',
    role: 'authenticated'
  };
  req.accessToken = 'local-dummy-token';
  next();
};

module.exports = authMiddleware;

