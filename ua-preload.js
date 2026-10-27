const { webFrame } = require('electron');

if (location.protocol !== 'file:') {
    const full = process.versions.chrome;
    const major = full.split('.')[0];
    const plat = process.platform === 'darwin' ? 'macOS' : (process.platform === 'linux' ? 'Linux' : 'Windows');
    webFrame.executeJavaScript(`(() => {
        try {
            const brands = [
                { brand: 'Not?A_Brand', version: '99' },
                { brand: 'Chromium', version: '${major}' },
                { brand: 'Google Chrome', version: '${major}' }
            ];
            const fullList = brands.map(b => ({ brand: b.brand, version: b.version === '99' ? '99.0.0.0' : '${full}' }));
            const data = {
                brands, mobile: false, platform: '${plat}',
                getHighEntropyValues: async () => ({
                    brands, fullVersionList: fullList, mobile: false, platform: '${plat}',
                    platformVersion: '10.0.0', architecture: 'x86', bitness: '64',
                    model: '', uaFullVersion: '${full}', wow64: false
                }),
                toJSON() { return { brands, mobile: false, platform: '${plat}' }; }
            };
            Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => data, configurable: true });
        } catch (e) {}
    })()`);
}