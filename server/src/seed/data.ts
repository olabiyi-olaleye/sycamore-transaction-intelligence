// Transaction generation lives in generateTransactions.ts, not here.

export type AccountRole = 'operating' | 'payroll' | 'reserve';

export interface SeedAccount {
  slug: string;
  name: string;
  bankName: string;
  accountNumberLast4: string;
  role: AccountRole;
}

export interface SeedUser {
  email: string;
  name: string;
  role: 'admin' | 'member';
}

export interface BusinessProfile {
  customers: string[];
  suppliers: string[];
  softwareVendors: string[];
  monthlySalaryKobo: number;
  monthlyRentKobo: number;
}

export interface SeedOrganisation {
  name: string;
  largePaymentMultiple: number;
  users: SeedUser[];
  accounts: SeedAccount[];
  profile: BusinessProfile;
}

export const SEED_ORGANISATIONS: SeedOrganisation[] = [
  {
    name: 'Lagos Fresh Foods Ltd',
    largePaymentMultiple: 5,
    users: [
      { email: 'adaeze.okafor@lagosfreshfoods.ng', name: 'Adaeze Okafor', role: 'admin' },
      { email: 'tunde.balogun@lagosfreshfoods.ng', name: 'Tunde Balogun', role: 'member' },
    ],
    accounts: [
      { slug: 'lff-operating', name: 'Operating Account', bankName: 'GTBank', accountNumberLast4: '4471', role: 'operating' },
      { slug: 'lff-payroll', name: 'Payroll Account', bankName: 'Zenith Bank', accountNumberLast4: '2208', role: 'payroll' },
    ],
    profile: {
      customers: ['Shoprite Lekki', 'Spar Victoria Island', 'Ebeano Supermarket', 'Justrite Enugu', 'Market Square Abuja'],
      suppliers: ['Dangote Flour Mills', 'Olam Nigeria', 'FanMilk Plc', 'Tomato Jos Farms', 'CrossRiver Logistics'],
      softwareVendors: ['AWS', 'Google Workspace'],
      monthlySalaryKobo: 850_000_00,
      monthlyRentKobo: 420_000_00,
    },
  },
  {
    name: 'Nimbus Cloud Systems Ltd',
    largePaymentMultiple: 5,
    users: [
      { email: 'chidi.eze@nimbuscloud.ng', name: 'Chidi Eze', role: 'admin' },
      { email: 'funmi.adeyemi@nimbuscloud.ng', name: 'Funmi Adeyemi', role: 'member' },
    ],
    accounts: [
      { slug: 'ncs-operating', name: 'Operating Account', bankName: 'Access Bank', accountNumberLast4: '7733', role: 'operating' },
      { slug: 'ncs-payroll', name: 'Payroll Account', bankName: 'UBA', accountNumberLast4: '9015', role: 'payroll' },
      { slug: 'ncs-reserve', name: 'Reserve Account', bankName: 'Access Bank', accountNumberLast4: '7740', role: 'reserve' },
    ],
    profile: {
      customers: ['Interswitch Ltd', 'Flutterwave Inc', 'Paystack Payments', 'Kuda Microfinance Bank', 'Moniepoint Inc'],
      suppliers: ['Andela Nigeria', 'MainOne Cable', 'Rack Centre Lagos', 'Decagon Institute', 'Terragon Group'],
      softwareVendors: ['AWS', 'GitHub', 'Vercel'],
      monthlySalaryKobo: 1_450_000_00,
      monthlyRentKobo: 980_000_00,
    },
  },
];
