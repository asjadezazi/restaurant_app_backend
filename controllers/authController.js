// controllers/authController
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const generateToken = require("../utils/generateToken");
const generateQR = require("../utils/generateQR");

// Register User
exports.registerUser = async (req, res) => {
  try {
    const { name, email, password, role, domain, restaurantName } = req.body;
    const creator = req.user;

    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ message: "Name, email, password, and role are required." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const baseData = { name, email, password: hashedPassword, role };

    // Role-based registration
    switch (role) {
      case "admin": {
        if (!domain || !restaurantName) {
          return res.status(400).json({
            message:
              "Domain and restaurantName are required for admin registration.",
          });
        }

        const qrCode = await generateQR(domain);

        const createdBy = creator ? creator._id : null;

        const admin = await User.create({
          ...baseData,
          domain,
          restaurantName,
          createdBy,
        });

        const restaurant = await Restaurant.create({
          user: admin._id,
          name,
          restaurantName,
          qrCode,
          domain,
        });

        admin.restaurantId = restaurant._id;
        await admin.save();

        const token = generateToken(admin._id);
        return res.status(201).json({
          message: "Admin registered successfully with restaurant.",
          user: {
            _id: admin._id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
            domain: admin.domain,
            restaurantId: admin.restaurantId,
          },
          restaurant: {
            _id: restaurant._id,
            restaurantName: restaurant.restaurantName,
            qrCode: restaurant.qrCode,
          },
          token,
        });
      }

      case "staff": {
        const admin = await User.findById(creator._id).populate("restaurantId");
        if (!admin || !admin.restaurantId) {
          return res
            .status(400)
            .json({ message: "Admin does not have a restaurant assigned." });
        }

        const staff = await User.create({
          ...baseData,
          restaurantId: admin.restaurantId._id,
          createdBy: creator._id,
        });

        const token = generateToken(staff._id);
        return res.status(201).json({
          message: "Staff registered successfully.",
          user: {
            _id: staff._id,
            name: staff.name,
            email: staff.email,
            role: staff.role,
            restaurantId: staff.restaurantId,
            createdBy: creator._id,
          },
          restaurant: {
            _id: admin.restaurantId._id,
            restaurantName: admin.restaurantId.restaurantName,
            domain: admin.restaurantId.domain,
          },
          token,
        });
      }

      case "superadmin": {
        const superadmin = await User.create(baseData);
        const token = generateToken(superadmin._id);
        return res.status(201).json({
          message: "Superadmin registered successfully.",
          user: {
            _id: superadmin._id,
            name: superadmin.name,
            email: superadmin.email,
            role: superadmin.role,
          },
          token,
        });
      }

      case "user": {
        const user = await User.create(baseData);
        const token = generateToken(user._id);
        return res.status(201).json({
          message: "User registered successfully.",
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
          token,
        });
      }

      default:
        return res.status(400).json({ message: "Invalid role specified." });
    }
  } catch (err) {
    console.error("User registration error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

// Login User
exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    // Fetch user with restaurant info if exists
    const user = await User.findOne({ email }).populate("restaurantId");

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate JWT including role
    const token = generateToken(
      user._id,
      user.role,
      user.restaurantId,
      user.createdBy,
    );

    // Prepare response object
    const response = {
      message: `${user.name} logged in successfully`,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurantId ? user.restaurantId._id : null,
        restaurantName: user.restaurantId
          ? user.restaurantId.restaurantName
          : null,
        qrCode: user.restaurantId ? user.restaurantId.qrCode : null,
        createdBy: user.createdBy || null, // for staff
      },
      token,
    };

    res.status(200).json(response);
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Update User (superadmin only)
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const updateData = { ...req.body, updatedAt: new Date() };
  const currentUser = req.user; // From auth middleware

  try {
    const userToUpdate = await User.findById(id);
    
    if (!userToUpdate) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if deleted
    if (userToUpdate.deleted) {
      return res.status(400).json({ message: "Cannot update deleted user" });
    }

    // Prevent editing superadmin
    if (userToUpdate.role === 'superadmin') {
      return res.status(403).json({ 
        message: "Superadmin cannot be edited" 
      });
    }

    // Admin can only be edited by superadmin
    if (userToUpdate.role === 'admin' && currentUser.role !== 'superadmin') {
      return res.status(403).json({ 
        message: "Only superadmin can edit admin users" 
      });
    }

    // Staff can be edited by superadmin or admin
    if (userToUpdate.role === 'staff') {
      if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
        return res.status(403).json({ 
          message: "Only superadmin or admin can edit staff users" 
        });
      }
    }

    // Prevent role changes
    if (updateData.role) {
      delete updateData.role;
    }

    // Hash password if provided
    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    // For ADMIN users: update both User and Restaurant
    if (userToUpdate.role === 'admin') {
      const { qrcode, restaurantName, ...userUpdateData } = updateData;
      
      // Update user (name is included in userUpdateData)
      const updatedUser = await User.findByIdAndUpdate(
        id,
        { $set: userUpdateData },
        { new: true, runValidators: true }
      ).select('-password');

      // Prepare restaurant update data
      const restaurantUpdateData = {};
      
      // If name is provided, update it in restaurant too
      if (updateData.name) restaurantUpdateData.name = updateData.name;
      if (qrcode) restaurantUpdateData.qrcode = qrcode;
      if (restaurantName) restaurantUpdateData.restaurantName = restaurantName;
      
      // Only update restaurant if there's data to update
      if (Object.keys(restaurantUpdateData).length > 0) {
        restaurantUpdateData.updatedAt = new Date();

        const updatedRestaurant = await Restaurant.findOneAndUpdate(
          { user: id },
          { $set: restaurantUpdateData },
          { new: true }
        );

        if (!updatedRestaurant) {
          return res.status(404).json({ 
            message: "User updated but restaurant not found for this admin" 
          });
        }

        return res.status(200).json({ 
          message: "User and restaurant updated successfully", 
          user: updatedUser,
          restaurant: updatedRestaurant
        });
      }

      return res.status(200).json({ 
        message: "User updated successfully", 
        user: updatedUser 
      });
    }

    // For STAFF and other users: update normally
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    res.status(200).json({ 
      message: "User updated successfully", 
      user: updatedUser 
    });

  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get all admins (superadmin only)
exports.getAllAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: "admin" }).lean();

    res.status(200).json({
      message: "Admins fetched successfully",
      count: admins.length,
      admins,
    });
  } catch (err) {
    console.error("Fetch admins error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get all staff (superadmin only)
exports.getAllStaff = async (req, res) => {
  try {
    const staff = await User.find({ role: "staff" }).lean();
    res.status(200).json({
      message: "Staff fetched successfully",
      count: staff.length,
      staff,
    });
  } catch (err) {
    console.error("Fetch staff error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get all staff (superadmin only)
exports.getAllStaffByAdmin = async (req, res) => {
  const creator = req.user;

  if (!creator) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const staff = await User.find({
      role: "staff",
      isDeleted: false,
      createdBy: creator._id,
    }).lean();

    res.status(200).json({
      message: "Staff fetched successfully",
      count: staff.length,
      staff,
    });
  } catch (err) {
    console.error("Fetch staff error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// delete user
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user; // From auth middleware

  try {
    const userToDelete = await User.findById(id);
    
    if (!userToDelete) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if already deleted
    if (userToDelete.deleted) {
      return res.status(400).json({ message: "User is already deleted" });
    }


    // Prevent deleting superadmin
    if (userToDelete.role === 'superadmin') {
      return res.status(403).json({ 
        message: "Superadmin cannot be deleted" 
      });
    }

    // Admin can only be deleted by superadmin
    if (userToDelete.role === 'admin' && currentUser.role !== 'superadmin') {
      return res.status(403).json({ 
        message: "Only superadmin can delete admin users" 
      });
    }

    // Staff can be deleted by superadmin or admin
    if (userToDelete.role === 'staff') {
      if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
        return res.status(403).json({ 
          message: "Only superadmin or admin can delete staff users" 
        });
      }
    }

    // Prevent self-deletion
    if (userToDelete._id.toString() === currentUser._id.toString()) {
      return res.status(403).json({ 
        message: "You cannot delete your own account" 
      });
    }

    // Soft delete
    userToDelete.isDeleted = true;
    userToDelete.deletedBy = currentUser._id;
    await userToDelete.save();

    res.status(200).json({ message: "User soft deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};