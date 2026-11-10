import { ErrorCode } from "@/lib/errorCodes";
import { ServiceError } from "@/lib/serviceError";
import { StatusCodes } from "http-status-codes";


export const lastOwnerError = (reason: "removed" | "left"): ServiceError => ({
    statusCode: StatusCodes.FORBIDDEN,
    errorCode: ErrorCode.LAST_OWNER_CANNOT_BE_REMOVED,
    message: reason === "left"
        ? "You are the last owner of this organization. Promote another member to owner before leaving."
        : "Cannot remove the last owner of the organization",
});

export const lastOwnerDemoteError = (): ServiceError => ({
    statusCode: StatusCodes.FORBIDDEN,
    errorCode: ErrorCode.LAST_OWNER_CANNOT_BE_DEMOTED,
    message: "Cannot demote the last owner. Promote another member to owner first.",
});

export const memberSuspendedError = (): ServiceError => ({
    statusCode: StatusCodes.BAD_REQUEST,
    errorCode: ErrorCode.MEMBER_SUSPENDED,
    message: "Suspended members cannot be promoted or demoted. Reactivate the member first.",
});
