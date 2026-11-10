import { auth } from "@/auth";
import { LoginForm } from "./components/loginForm";
import { redirect } from "next/navigation";
import { Footer } from "@/app/components/footer";
import { SINGLE_TENANT_ORG_ID } from "@/lib/constants";
import { __unsafePrisma } from "@/prisma";
import { isAnonymousAccessEnabled } from "@/lib/anonymousAccess";

interface LoginProps {
    searchParams: Promise<{
        callbackUrl?: string;
        error?: string;
    }>
}

export default async function Login(props: LoginProps) {
    const searchParams = await props.searchParams;
    const session = await auth();
    if (session) {
        return redirect("/");
    }

    const org = await __unsafePrisma.org.findUnique({ where: { id: SINGLE_TENANT_ORG_ID } });
    if (!org || !org.isOnboarded) {
        return redirect("/onboard");
    }

    const anonymousAccessEnabled = await isAnonymousAccessEnabled();

    return (
        <div className="flex flex-col min-h-screen bg-backgroundSecondary">
            <div className="flex-1 flex flex-col items-center p-4 sm:p-12 w-full">
                <LoginForm
                    callbackUrl={searchParams.callbackUrl}
                    error={searchParams.error}
                    context="login"
                    loginMessage={org.loginMessage}
                    isAnonymousAccessEnabled={anonymousAccessEnabled}
                />
            </div>
            <Footer />
        </div>
    )
}
