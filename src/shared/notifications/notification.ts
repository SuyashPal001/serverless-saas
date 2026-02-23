import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import {
  CoachSession,
  INotification,
  SessionModel,
  StudioProfileSession,
  UserNotification,
} from "@fit-earn-meditate/backend-shared-models";
import { UploadContext } from "../identity/userIdentityHelper";
import logger from '@/shared/utils/loggerNew';
// import { UploadContext } from "@/identity/userIdentityHelper";
// import { logger } from "@/utils/loggerNew";

export interface NotificationPayload {
  title: string;
  body: string;
  link?: string;
  image?: string;
  moduleType?: string;
  moduleId?: string;
}

export const sendNotification = async (
  firebaseApp: App, //Targetted firebase app like Studio, Coach, User. in future admin also
  userId: string,
  payload: NotificationPayload,
  fcmToken: string | null,
): Promise<void> => {
  try {
    // Step 1: Generate a unique notificationId
    const notificationId = uuidv4();

    // Step 2: Prepare notification details to save in the database
    const notificationDetails: INotification = {
      notificationId,
      notificationTitle: payload.title,
      notificationBody: payload.body,
      timestamp: new Date(),
      isRead: false,
      image: payload.image || "",
      url: payload.link || "",
      moduleType: payload.moduleType || "",
      moduleId: payload.moduleId || "",
    };
    // Step 3: Save the notification in the database
    const existingUserNotification = await UserNotification.findOne({ userId });

    if (existingUserNotification) {
      existingUserNotification.notifications.push(notificationDetails);
      await existingUserNotification.save();
    } else {
      await UserNotification.create({
        userId,
        notifications: [notificationDetails],
      });
    }

    // console.log("Studio Notification stored successfully in the database.");

    // Step 4: Prepare the push notification payload

    //if fcmToken is available then notification will send and if not the nothing will happen
    if (fcmToken) {
      const message = {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: {
          type: payload.moduleType || "",
          id: payload.moduleId || "",
          link: payload.link || "",
        },
        token: fcmToken,
        webpush: {
          fcmOptions: {
            link: payload.link || "",
          },
        },
      };
      await getMessaging(firebaseApp).send(message);
    } else {
      //   console.log("fcm Token is missing ", userId);
    }
  } catch (error: any) {
    // console.error(
    //   "Error occurred while processing studio notification:",
    //   error.message
    // );
    throw new Error("Failed to process studio notification: " + error.message);
  }
};

// Only for Admin | Coach | Studio
// User UploadContext.[your module] it will fetch accordingly, free to add more and modify
export const getUserFcmTokenCommon = async (
  userId: string,
  appType: string,
): Promise<string | null> => {
  try {
    let session: any;
    switch (appType) {
      case "admin":
        session = await SessionModel.findOne({ userId }).select("fcmToken");
        break;
      case "studio":
        session = await StudioProfileSession.findOne({
          ownerId: userId,
        }).select("fcmToken");
        break;
      case "coach":
        session = await CoachSession.findOne({ coachId: userId }).select(
          "fcmToken",
        );
        break;
      default:
        console.error("Invalid module name");
        return null;
    }
    return session?.fcmToken ?? null;
  } catch (error) {
    console.error("Error fetching FCM token:", error);
    return null;
  }
};

export const sendStudioNotification = async (
  firebaseApp: App,
  userId: string,
  payload: NotificationPayload,
  appType: UploadContext,
) => {
  try {
    const fcmToken = await getUserFcmTokenCommon(userId, appType);
    if (!fcmToken) {
      await sendNotification(firebaseApp, userId, payload, null);
    } else {
      await sendNotification(firebaseApp, userId, payload, fcmToken);
    }
  } catch (error) {
    logger.error(`Failed to send notification to user ${userId}:`, error);
  }
};

export const getBaseURL = (req: Request) => {
  const isLocalhost = req.headers?.host?.includes("localhost");
  const isDev = process.env.NODE_ENV === "development";
  const isProd = process.env.NODE_ENV === "prod";

  console.log({ isLocalhost: isLocalhost, isDev: isDev, isProd: isProd });

  if (isLocalhost) return "http://localhost:3001";
  if (isProd) return "https://example.com";
  return "https://dev.example.com"; // dev/staging
};
