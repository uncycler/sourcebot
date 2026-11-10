import { authenticatedPage } from "@/middleware/authenticatedPage";
import { OrgRole } from "@sourcebot/db";
import { getOrgMembers, getOrgInvites, getOrgAccountRequests } from "@/features/membership/actions";
import { isServiceError } from "@/lib/utils";
import { ServiceErrorException } from "@/lib/serviceError";
import { MembersTableView } from "./membersTableView";

export default authenticatedPage(async ({ user }) => {
    const [members, invites, requests] = await Promise.all([
        getOrgMembers(),
        getOrgInvites(),
        getOrgAccountRequests(),
    ]);

    if (isServiceError(members)) {
        throw new ServiceErrorException(members);
    }
    if (isServiceError(invites)) {
        throw new ServiceErrorException(invites);
    }
    if (isServiceError(requests)) {
        throw new ServiceErrorException(requests);
    }

    return (
        <div className="flex flex-1 min-h-0 flex-col gap-6">
            <div>
                <h3 className="text-lg font-medium">Members</h3>
                <p className="text-sm text-muted-foreground">
                    Invite and manage members of your organization.
                </p>
            </div>
            <MembersTableView
                members={members}
                invites={invites}
                requests={requests}
                currentUserId={user.id}
            />
        </div>
    );
}, {
    minRole: OrgRole.OWNER,
    redirectTo: '/settings'
})
