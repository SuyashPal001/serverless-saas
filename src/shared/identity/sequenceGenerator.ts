import { Request, Response, NextFunction } from "express";
import { ModelCounter } from "@fit-earn-meditate/backend-shared-models";

// Function to generate a unique numeric sequence for bookings, queries, etc.
export async function generateUniqueSequence(prefix: string): Promise<number> {
  try {
    const counter = await ModelCounter.findByIdAndUpdate(
      prefix,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    return counter.seq;
  } catch (error) {
    console.error("Error generating unique sequence:", error);
    throw new Error("Failed to generate unique sequence");
  }
}

// Custom Request interface with generatedId property
interface CustomRequest extends Request {
  generatedId?: string;
}

// Middleware for Express to generate ID and attach it to the request object
export function idGenerationMiddleware(prefix: string) {
  return async (req: CustomRequest, res: Response, next: NextFunction) => {
    try {
      const sequence = await generateUniqueSequence(prefix); // Use the prefix passed from the route definition
      const generatedId = `${prefix}${sequence.toString().padStart(5, "0")}`; // Fixed template literal

      // Attach the generated ID to the request object
      req.generatedId = generatedId;
      console.log("Generated ID:", generatedId);
      next();
    } catch (error) {
      console.error("Error generating ID:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate unique ID: " + (error as any).message,
      });
    }
  };
}

export const generateUniqueId = async (prefix: string): Promise<string> => {
  try {
    const sequence = await generateUniqueSequence(prefix);
    return `${prefix}${sequence.toString().padStart(5, "0")}`;
  } catch (error) {
    return `${prefix}${new Date()}`;
  }
};
