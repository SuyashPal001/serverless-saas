import { Response, NextFunction } from "express";
import { AdminType, RoleModel } from "@fit-earn-meditate/backend-shared-models";
import {
  PermissionModel,
  GroupModel,
} from "@fit-earn-meditate/backend-shared-models";
import { CustomRequest } from "./authenticateAdminToken"; // import the custom request type
import jwt from "jsonwebtoken";
/**
 * Middleware to authorize users based on role and required permissions for a module.
 * Ensures "View" access is granted before allowing any higher-level permissions.
 * Denies access if the permission is explicitly restricted in permissionBoundary.
 *
 * @param {Role[]} requiredRoles - Array of allowed roles.
 * @param {string} moduleName - The module name to check permission against.
 * @param {string} requiredPermission - The specific permission required (e.g., "View", "Edit").
 */

interface PermissionBoundary {
  permissionID: string;
  actionKey: string;
  permissionName: string;
  description: string;
  // Add other fields as necessary
}

// Modules allowed for ACCESSMANAGER
//const ACCESSMANAGER_ALLOWED_MODULES = ['UserManagement', 'AccessControl'];

// Enhanced authorize function that handles self-access for user details
export const authorize = (
  requiredActionKey: string,
  options?: { allowSelfAccess?: boolean }
) => {
  return async (req: CustomRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.adminUser;

      if (!user) {
        return res
          .status(403)
          .json({ success: false, error: "Admin not authenticated" });
      }

      // Special handling for self-access when viewing user details
      if (options?.allowSelfAccess) {
        const { USR_ID } = req.params;
        const isSelf = user.USR_ID === USR_ID;

        if (isSelf) {
          return next(); // Allow self-access without permission check
        }
      }

      //const userRole = user.role as RoleType;
      const userRole = user.AdminType as AdminType;

      // Step 1: Get permission IDs in boundary
      const userBoundaryIds: string[] = user.permissionBoundary || [];

      // Step 2: Fetch actionKeys from PermissionModel
      const boundaryPermissions = await PermissionModel.find({
        permissionID: { $in: userBoundaryIds },
      }).select("actionKey");

      // Step 3: Extract actionKeys
      const boundaryActionKeys = boundaryPermissions.map((p) => p.actionKey);

      // Step 4: Check restriction
      if (boundaryActionKeys.includes(requiredActionKey)) {
        return res.status(403).json({
          success: false,
          error: `Access denied: "${requiredActionKey}" is restricted by user's permission boundaries`,
        });
      }

      // Step 5: SUPERADMINs are allowed unless denied above
      if (userRole === AdminType.SUPERADMIN) {
        return next();
      }

      // Step 6: Fetch roles and groups
      const groups = await GroupModel.find({ groupId: { $in: user.groupid } });
      const roles = await RoleModel.find({ roleId: { $in: user.Roleid } });

      // Step 7: Aggregate all permissions
      const userPermissions = user.permissions || [];
      const rolePermissions = roles.flatMap((r) => r.permissionId || []);
      const groupPermissions = groups.flatMap((g) => g.permissionId || []);

      const allEffectivePermissions = new Set([
        ...groupPermissions,
        ...rolePermissions,
        ...userPermissions,
      ]);

      // Step 8: ACCESSMANAGER logic (enhanced with module-based permission override)

      /*
          if (userRole === AdminType.ACCESSMANAGER) {
    console.log('I am ACCESSMANAGER', userRole);

    const accessManagerModuleIds = ['MODULE-1', 'MODULE-3'];

    const overridePermissions = await PermissionModel.find({
      moduleID: { $in: accessManagerModuleIds },
      actionKey: requiredActionKey,
    });

    if (overridePermissions.length === 0) {
      return res.status(403).json({
        success: false,
        error: `Access denied: ACCESSMANAGER attempted "${requiredActionKey}", but it's not part of MODULE-1 or MODULE-3`,
      });
    }

    const isBlocked = overridePermissions.some((perm) => user.permissionBoundary?.includes(perm.permissionID));

    console.log(isBlocked, 'isBlocked');

    if (isBlocked) {
      return res.status(403).json({
        success: false,
        error: `Access denied: "${requiredActionKey}" is restricted by permission boundaries`,
      });
    }//

    // ✅ Inject permissions for downstream checks (like getUserDetails)
req.permissions = overridePermissions.map((p) => p.actionKey);
console.log('✅ Authorization passed. Proceeding to next()');
    return next();
  }
  */
      // Step 9: For all other roles, require _VIEW permission before action
      const skipViewCheckActions = ["DOWNLOAD_SAMPLE_CSV"];
      if (!skipViewCheckActions.includes(requiredActionKey)) {
        const viewKey = requiredActionKey.replace(
          /_(CREATE|EDIT|DELETE|APPROVE|REVIEW|MANAGE|UPLOAD)$/,
          "_VIEW"
        );

        const hasViewPermission = await PermissionModel.findOne({
          permissionID: { $in: Array.from(allEffectivePermissions) },
          actionKey: viewKey,
        });

        if (!hasViewPermission) {
          return res.status(403).json({
            success: false,
            error: `Access denied: "${viewKey}" permission is required before accessing "${requiredActionKey}"`,
          });
        }
      }

      // Step 10: Final permission check
      const permission = await PermissionModel.findOne({
        permissionID: { $in: Array.from(allEffectivePermissions) },
        actionKey: requiredActionKey,
      });
      console.log("permissions", permission);

      if (!permission) {
        return res.status(403).json({
          success: false,
          error: `Access denied: Missing "${requiredActionKey}" permission (direct/role/group)`,
        });
      }
      // Inject permission list into req so getUserDetails can validate it
      req.permissions = [...allEffectivePermissions];

      // All checks passed
      return next();
    } catch (err) {
      console.error("Authorization Error:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  };
};

// Middleware that only allows users to access their own resources
export const authorizeSelfOnly = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = req.adminUser;

    if (!user) {
      return res
        .status(403)
        .json({ success: false, error: "Admin not authenticated" });
    }

    // For email verification endpoint - check if email matches user's email
    if (req.params.email) {
      const { email } = req.params;
      if (user.email !== email) {
        return res.status(403).json({
          success: false,
          error: "Access denied: You can only verify your own email address",
        });
      }
    }

    // For password reset endpoint - check if token contains user's ID
    if (req.body.token) {
      try {
        const decoded = jwt.verify(
          req.body.token,
          process.env.JWT_SECRET as string
        ) as { userId: string; email: string };

        if (user.USR_ID !== decoded.userId || user.email !== decoded.email) {
          return res.status(403).json({
            success: false,
            error: "Access denied: You can only reset your own password",
          });
        }
      } catch (tokenError) {
        // If token is invalid, let the controller handle it
        // Don't block here since controller has proper token validation
      }
    }

    // All checks passed
    return next();
  } catch (err) {
    console.error("Self-only Authorization Error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

export const authorizeMultiple = (
  requiredActionKeys: string[],
  options?: { allowSelfAccess?: boolean }
) => {
  return async (req: CustomRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.adminUser;

      if (!user) {
        return res
          .status(403)
          .json({ success: false, error: "Admin not authenticated" });
      }

      // Allow self access if option enabled
      if (options?.allowSelfAccess) {
        const { USR_ID } = req.params;
        if (user.USR_ID === USR_ID) {
          return next();
        }
      }

      const userRole = user.AdminType as AdminType;

      // SUPERADMIN → bypass
      if (userRole === AdminType.SUPERADMIN) {
        return next();
      }

      // 1️⃣ Collect all effective permissions
      const groups = await GroupModel.find({ groupId: { $in: user.groupid } });
      const roles = await RoleModel.find({ roleId: { $in: user.Roleid } });

      const userPermissions = user.permissions || [];
      const rolePermissions = roles.flatMap((r) => r.permissionId || []);
      const groupPermissions = groups.flatMap((g) => g.permissionId || []);

      const allEffectivePermissions = new Set([
        ...groupPermissions,
        ...rolePermissions,
        ...userPermissions,
      ]);

      // 2️⃣ Check each required action key
      const skipViewCheckActions = ["DOWNLOAD_SAMPLE_CSV"];
      const missingPermissions: string[] = [];

      for (const actionKey of requiredActionKeys) {
        // VIEW check
        if (!skipViewCheckActions.includes(actionKey)) {
          const viewKey = actionKey.replace(
            /_(CREATE|EDIT|DELETE|APPROVE|REVIEW|MANAGE|UPLOAD)$/,
            "_VIEW"
          );

          const hasViewPermission = await PermissionModel.findOne({
            permissionID: { $in: Array.from(allEffectivePermissions) },
            actionKey: viewKey,
          });

          if (!hasViewPermission) {
            missingPermissions.push(viewKey);
            continue; // No need to check deeper if view itself missing
          }
        }

        // Actual permission check
        const hasPermission = await PermissionModel.findOne({
          permissionID: { $in: Array.from(allEffectivePermissions) },
          actionKey,
        });

        if (!hasPermission) {
          missingPermissions.push(actionKey);
        }
      }

      // 3️⃣ If any missing permissions → deny
      if (missingPermissions.length > 0) {
        return res.status(403).json({
          success: false,
          error: "Access denied: Missing required permissions",
          missingPermissions,
        });
      }

      // ✅ All good
      req.permissions = [...allEffectivePermissions];
      return next();
    } catch (err) {
      console.error("Authorization Error:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  };
};
