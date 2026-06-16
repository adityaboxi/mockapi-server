const User = require('../models/User');

/**
 * Subscribe controller – sets the user's subscription status to true.
 * Expects authenticated request with valid JWT token (username in req.user).
 * POST /api/subscribe
 */
async function subscribe(req, res) {
  const username = req.user?.username;

  if (!username) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Idempotency key (optional) – could be stored in Redis with TTL from env
  // const idempotencyKey = req.body.idempotencyKey;
  // const IDEMPOTENCY_TTL = parseInt(process.env.IDEMPOTENCY_TTL, 10);

  try {
    const user = await User.findOneAndUpdate(
      { username, subscribe: false },
      { $set: { subscribe: true, subscriptionUpdatedAt: new Date() } },
      { new: true, projection: { password: 0, __v: 0 } }
    );

    if (!user) {
      const existingUser = await User.findOne({ username }).select('subscribe');
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (existingUser.subscribe === true) {
        return res.status(200).json({
          success: true,
          message: 'Already subscribed',
          subscribe: true
        });
      }
      return res.status(400).json({ error: 'Unable to process subscription' });
    }

    console.log(`✅ Subscription completed for user: ${user.username}`);

    return res.status(200).json({
      success: true,
      message: 'Subscription activated',
      subscribe: true,
      user: { id: user._id, username: user.username, subscribe: user.subscribe }
    });
  } catch (error) {
    console.error('Subscription error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = subscribe;