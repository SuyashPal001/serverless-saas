import { AdminRevokedToken } from "@fit-earn-meditate/backend-shared-models";

/**
 * This function revokes a JWT token by adding it to a "revoked tokens" collection in the database. It checks if the token is already revoked and if the user ID is valid before creating a new entry in the collection.
 * If any errors occur, it logs the error and re-throws it.
 * @param token - The JWT token to be revoked
 * @param userId - The ID of the user who owns the token
 * @param reason - The reason for revoking the token (for logging purposes)
 */
export async function revokeToken(
  token: string,
  adminId: string,
  reason: string,
): Promise<void> {
  try {
    // Check if the token is already revoked
    const existingToken = await AdminRevokedToken.findOne({ token });
    if (existingToken) {
      throw new Error("Token already revoked");
    }

    // Ensure userId is valid and convert to ObjectId
    if (!adminId) {
      throw new Error("Invalid adminId");
    }
    //const userIdObjectId = new mongoose.Types.ObjectId(userId);

    // Create a new entry in the revoked tokens collection
    const revokedToken = new AdminRevokedToken({
      token,
      adminId: adminId,
      reason,
    });
    await revokedToken.save();
  } catch (error) {
    console.error("Error revoking token:", error);
    throw error;
  }
}
// Function to check if a token is revoked
export async function isTokenRevoked(token: string): Promise<boolean> {
  try {
    const existingToken = await AdminRevokedToken.findOne({ token });
    return !!existingToken; // If the token exists, return true (token is revoked)
  } catch (error) {
    console.error("Error checking revoked token:", error);
    return true; // Treat error as if the token is revoked (to err on the side of security)
  }
}
