import { createEtherealAccount } from '../ethereal.js';
const account = await createEtherealAccount();
console.log('Ethereal test account (keep password private):');
console.log(
  JSON.stringify(
    {
      email: account.user,
      password: account.pass,
      host: account.smtp.host,
      port: account.smtp.port,
      inbox: 'https://ethereal.email/login',
    },
    null,
    2,
  ),
);
