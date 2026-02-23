import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserModel } from "@fit-earn-meditate/backend-shared-models";
import { AdminSessionModel } from "@fit-earn-meditate/backend-shared-models"; // adjust path if needed

export interface CustomRequest extends Request {
  adminUser?: any; // can type this later to IUserAdmin
  permissions?: string[]; // Add permissions property for authorization middleware
}

export const authenticateAdminToken = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.headers.gentoken as string;

    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: "Token missing from header" });
    }
    // console.log("SECRET", process.env.JWT_SECRET);
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
      adminId: string;
    };

    const session = await AdminSessionModel.findOne({
      adminId: decoded.adminId,
      JWT_Token: token,
    });
    // console.log("SESSION", session);
    if (!session) {
      return res
        .status(401)
        .json({ success: false, error: "Session expired or invalid token" });
    }

    // Fetch user
    const user = await UserModel.findOne({ USR_ID: decoded.adminId });

    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Admin user not found" });
    }

    req.adminUser = user;

    next();
  } catch (error: any) {
    console.error("Authentication error:", error.message);
    return res.status(401).json({
      success: false,
      error: "Session expired or invalid token: " + error.message,
    });
  }
};
