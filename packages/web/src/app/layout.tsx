/**
 * Render all routes at request time rather than build time,
 * since every route depends on per-request session and DB-backed data, none of which are available at build time.
 * @see https://nextjs.org/docs/app/guides/caching-without-cache-components#route-segment-config
 */
export const dynamic = 'force-dynamic';

import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { ProgressBarProvider } from "./progressBarProvider";
import { QueryClientProvider } from "./queryClientProvider";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "next-auth/react";
import { env } from "@sourcebot/shared";
import { IdentityProvidersProvider } from "@/features/auth/identityProvidersProvider";
import { getIdentityProviderMetadata } from "@/lib/identityProviders";

export const metadata: Metadata = {
    metadataBase: env.AUTH_URL ? new URL(env.AUTH_URL) : undefined,
    // Using the title.template will allow child pages to set the title
    // while keeping a consistent suffix.
    title: {
        default: "Sourcebot",
        template: "%s | Sourcebot",
    },
    description:
        "Sourcebot is a self-hosted code understanding tool. Ask questions about your codebase and get rich Markdown answers with inline citations.",
    manifest: "/manifest.json",
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const identityProviders = await getIdentityProviderMetadata();

    return (
        <html
            lang="en"
            // @see : https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app
            suppressHydrationWarning
        >
            <head>
                {env.NODE_ENV === "development" && env.DEBUG_ENABLE_REACT_SCAN === 'true' && (
                    <Script
                        src="//unpkg.com/react-scan/dist/auto.global.js"
                        crossOrigin="anonymous"
                        strategy="beforeInteractive"
                    />
                )}
                {env.NODE_ENV === "development" && env.DEBUG_ENABLE_REACT_GRAB === 'true' && (
                    <Script
                        src="//unpkg.com/react-grab/dist/index.global.js"
                        crossOrigin="anonymous"
                        strategy="beforeInteractive"
                    />
                )}
                {env.NODE_ENV === "development" && env.DEBUG_ENABLE_REACT_GRAB === 'true' && (
                    <Script
                        src="//unpkg.com/@react-grab/mcp/dist/client.global.js"
                        strategy="lazyOnload"
                    />
                )}
            </head>
            <body>
                <Toaster />
                <SessionProvider>
                    <IdentityProvidersProvider providers={identityProviders}>
                        <ThemeProvider
                            attribute="class"
                            defaultTheme="system"
                            enableSystem
                            disableTransitionOnChange
                        >
                            <QueryClientProvider>
                                <TooltipProvider>
                                    <ProgressBarProvider>
                                        {children}
                                    </ProgressBarProvider>
                                </TooltipProvider>
                            </QueryClientProvider>
                        </ThemeProvider>
                    </IdentityProvidersProvider>
                </SessionProvider>
            </body>
        </html>
    );
}
