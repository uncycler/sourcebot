import { AnonymousAccessEnabledSettingsCard } from "./components/anonymousAccessEnabledSettingsCard";
import { InviteLinkEnabledSettingsCard } from "./components/inviteLinkEnabledSettingsCard";
import { MemberApprovalRequiredSettingsCard } from "./components/memberApprovalRequiredSettingsCard";
import { CredentialsLoginEnabledSettingsCard } from "./components/credentialsLoginEnabledSettingsCard";
import { EmailCodeLoginEnabledSettingsCard } from "./components/emailCodeLoginEnabledSettingsCard";
import { LoginMessageSettingsCard } from "./components/loginMessageSettingsCard";
import { isAnonymousAccessEnabled } from "@/lib/anonymousAccess";
import { createInviteLink } from "@/lib/utils";
import { authenticatedPage } from "@/middleware/authenticatedPage";
import { OrgRole } from "@sourcebot/db";
import { env, getSMTPConnectionURL, isCredentialsLoginEnabled, isEmailCodeLoginEnabled, isMemberApprovalRequired } from "@sourcebot/shared";
import { SettingsCardGroup } from "../components/settingsCard";

export default authenticatedPage(async ({ org }) => {
    const anonymousAccessEnabled = await isAnonymousAccessEnabled();
    const inviteLink = createInviteLink(env.AUTH_URL, org.inviteLinkId);

    return (
        <div className="flex flex-col gap-6">
            <h2 className="text-lg font-medium">Security</h2>
            <div className="space-y-6">
                <div>
                    <p className="text-md font-medium">Organization access</p>
                    <p className="text-sm text-muted-foreground">Configure how users can access your Sourcebot deployment.{" "}
                        <a
                            href="https://docs.sourcebot.dev/docs/configuration/auth/access-settings"
                            target="_blank"
                            rel="noopener"
                            className="text-link hover:underline transition-colors"
                        >
                            Learn more
                        </a>
                    </p>
                </div>

                <SettingsCardGroup>
                    <InviteLinkEnabledSettingsCard
                        inviteLinkEnabled={org.inviteLinkEnabled}
                        inviteLink={inviteLink}
                    />
                    <MemberApprovalRequiredSettingsCard
                        memberApprovalRequired={isMemberApprovalRequired(org)}
                    />
                    <AnonymousAccessEnabledSettingsCard
                        anonymousAccessEnabled={anonymousAccessEnabled}
                    />
                </SettingsCardGroup>

                <p className="text-md font-medium">Email login</p>

                <SettingsCardGroup>
                    <CredentialsLoginEnabledSettingsCard
                        isCredentialsLoginEnabled={isCredentialsLoginEnabled(org)}
                    />
                    <EmailCodeLoginEnabledSettingsCard
                        isEmailCodeLoginEnabled={isEmailCodeLoginEnabled(org)}
                        isEmailServiceConfigured={!!getSMTPConnectionURL() && !!env.EMAIL_FROM_ADDRESS}
                    />
                </SettingsCardGroup>

                <section aria-labelledby="login-message-heading" className="space-y-4">
                    <div>
                        <h3 id="login-message-heading" className="text-md font-medium">Login message</h3>
                        <p className="text-sm text-muted-foreground">Show access instructions or a registration link on your sign-in and sign-up pages.</p>
                    </div>
                    <LoginMessageSettingsCard loginMessage={org.loginMessage} />
                </section>
            </div>
        </div>
    )
}, {
    minRole: OrgRole.OWNER,
    redirectTo: '/settings',
});
