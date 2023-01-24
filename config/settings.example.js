export default {
    accounts: [
        {
            email: 'account1@example.com',
            password: 'password1',
            // Any other options that `ChatGPTAPIBrowser` supports...
        },
        {
            email: 'account2@example.com',
            password: 'password2',
            proxyServer: 'user:pass@ip:port',
        },
        {
            email: 'account3@example.com',
            password: 'password3',
            proxyServer: 'ip:port',
            // Example of overriding the default `nopechaKey` for this account
            nopechaKey: undefined,
        },
        // Add more accounts as needed...
    ],
    // The port the server will run on (optional, defaults to 3000)
    port: 3000,
    // Your NopeCHA API key. This will be applied to all accounts but can be overridden on a per-account basis.
    nopechaKey: undefined,
    // Your 2Captcha API key. This will be applied to all accounts but can be overridden on a per-account basis.
    twoCaptchaKey: undefined,

    // The origin to allow for CORS (optional, defaults to '*')
    corsOrigin: ['*'],

    // The auth key to use for request header Authentication (optional). Set as undefined to disable authentication. 
    authKey: 'secret',
    notificationURL: 'https://example.com/notify',
}
