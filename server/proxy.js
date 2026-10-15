export function configureProxy(app,value=process.env.TRUST_PROXY || 'false') {
 if(!['false','loopback'].includes(value))throw new Error('TRUST_PROXY must be false or loopback. Use loopback only for a reverse proxy on this server.');
 app.set('trust proxy',value==='loopback'?'loopback':false);
}
