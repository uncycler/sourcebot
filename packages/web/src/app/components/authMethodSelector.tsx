'use client';

import { MagicLinkForm } from "@/app/login/components/magicLinkForm";
import { CredentialsForm } from "@/app/login/components/credentialsForm";
import { DividerSet } from "@/app/components/dividerSet";
import Link from "next/link";
import { useIdentityProviders } from "@/features/auth/useIdentityProviders";

interface AuthMethodSelectorProps {
    callbackUrl?: string;
    context: "login" | "signup";
}

export const AuthMethodSelector = ({
    callbackUrl,
    context,
}: AuthMethodSelectorProps) => {
    const providers = useIdentityProviders();

    const hasCredentials = providers.some(p => p.type === "credentials");
    const hasMagicLink = providers.some(p => p.type === "nodemailer");

    if (!hasCredentials && !hasMagicLink) {
        return (
            <div className="flex flex-col items-center justify-center w-full gap-2">
                <p className="text-center font-medium">No authentication methods available. Please contact your administrator to configure authentication.</p>
                <Link href="https://docs.sourcebot.dev/docs/configuration/auth/authentication" target="_blank" rel="noopener" className="text-link hover:underline">Learn more</Link>
            </div>
        )
    }

    return (
        <>
            <DividerSet
                elements={[
                    ...(hasMagicLink ? [
                        <MagicLinkForm key="magic-link" callbackUrl={callbackUrl} context={context} />
                    ] : []),
                    ...(hasCredentials ? [
                        <CredentialsForm key="credentials" callbackUrl={callbackUrl} context={context} />
                    ] : [])
                ]}
            />
        </>
    );
}; 