/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",

    // Version skew protection for rolling deploys.
    // @see: https://nextjs.org/docs/app/guides/self-hosting#version-skew
    deploymentId: process.env.NEXT_PUBLIC_BUILD_COMMIT_SHA,

    // This is required when using standalone builds.
    // @see: https://env.t3.gg/docs/nextjs#create-your-schema
    transpilePackages: ["@t3-oss/env-core"],

    // Apply HTTP security headers to all responses to align with security
    // hardening best practices (defends against clickjacking, MIME-sniffing,
    // TLS downgrade, and referrer leakage). We intentionally avoid a strict
    // Content-Security-Policy `script-src` here since Next.js relies
    // on inline scripts; instead CSP is scoped to `frame-ancestors`
    // to prevent framing, mirroring the X-Frame-Options directive below.
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    {
                        key: "Strict-Transport-Security",
                        value: "max-age=63072000; includeSubDomains",
                    },
                    {
                        key: "X-Content-Type-Options",
                        value: "nosniff",
                    },
                    {
                        key: "X-Frame-Options",
                        value: "SAMEORIGIN",
                    },
                    {
                        key: "Referrer-Policy",
                        value: "strict-origin-when-cross-origin",
                    },
                    {
                        key: "Permissions-Policy",
                        value: "camera=(), microphone=(), geolocation=()",
                    },
                    {
                        key: "Content-Security-Policy",
                        value: "frame-ancestors 'self'",
                    },
                ],
            },
        ];
    },

    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '**',
            },
        ]
    },

    turbopack: {
        rules: {
            '*.txt': {
                loaders: ['raw-loader'],
                as: '*.js',
            },
        },
    },

    // @see: https://github.com/vercel/next.js/issues/58019#issuecomment-1910531929
    ...(process.env.NODE_ENV === 'development' ? {
        experimental: {
            serverActions: {
                allowedOrigins: [
                    'localhost:3000'
                ]
            }
        }
    } : {}),
};

export default nextConfig;
