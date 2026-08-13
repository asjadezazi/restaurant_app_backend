  let clients = [];

  const addClient = (req, res) => {
    const clientId = Date.now() + Math.random();
    let adminId = null;

    if (req.user?.role === "admin") {
      adminId = req.user._id; // admin uses own id
    } else if (req.user?.role === "staff") {
      adminId = req.user.createdBy; // staff uses createdBy
    }

    const newClient = {
      id: clientId,
      role: req.user?.role || "guest",
      adminId,
      fingerPrint: req.query.fingerPrint || null,
      res
    };

    clients.push(newClient);

    // Initial handshake
    res.write(`data: ${JSON.stringify({ type: "CONNECTED" })}\n\n`);

    req.on('close', () => {
      clients = clients.filter(c => c.id !== clientId);
    });
  };


  // Send Events Safely
  const sendEvent = (type, data) => {
  clients.forEach(client => {
    try {

      const isAdminOrStaff =
        client.role === "admin" || client.role === "staff";

      const sameRestaurant =
        String(client.adminId) === String(data.user);

      const isSameGuest =
        client.fingerPrint &&
        data.fingerPrint &&
        client.fingerPrint === data.fingerPrint;

      // ADMIN + STAFF
      if (
        (type === "NEW_ORDER" || type === "ORDER_UPDATED" || type === "OCCUPANCY_CHANGED") &&
        isAdminOrStaff &&
        sameRestaurant
      ) {
        client.res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
      }

      // GUEST (only for updates)
      if (
        type === "ORDER_UPDATED" &&
        isSameGuest
      ) {
        client.res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
      }

    } catch (err) {
      clients = clients.filter(c => c.id !== client.id);
    }
  });
};


  // Keep Alive
  setInterval(() => {
    clients.forEach(client => {
      try {
        client.res.write(': keep-alive\n\n');
      } catch {
        clients = clients.filter(c => c.id !== client.id);
      }
    });
  }, 25000);


  module.exports = {
    addClient,
    sendEvent
  };