import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // --- Currencies (ISO 4217, launch markets + common globals) ---
  await prisma.currency.createMany({
    data: [
      { code: 'EGP', numericCode: '818', nameEn: 'Egyptian Pound', nameAr: 'جنيه مصري', symbol: 'ج.م', decimalDigits: 2 },
      { code: 'AED', numericCode: '784', nameEn: 'UAE Dirham', nameAr: 'درهم إماراتي', symbol: 'د.إ', decimalDigits: 2 },
      { code: 'SAR', numericCode: '682', nameEn: 'Saudi Riyal', nameAr: 'ريال سعودي', symbol: 'ر.س', decimalDigits: 2 },
      { code: 'USD', numericCode: '840', nameEn: 'US Dollar', nameAr: 'دولار أمريكي', symbol: '$', decimalDigits: 2 },
      { code: 'EUR', numericCode: '978', nameEn: 'Euro', nameAr: 'يورو', symbol: '€', decimalDigits: 2 },
    ],
    skipDuplicates: true,
  });

  // --- Countries (launch markets) ---
  await prisma.country.createMany({
    data: [
      { isoCode: 'EG', nameEn: 'Egypt', nameAr: 'مصر', defaultCurrencyCode: 'EGP', isSupported: true },
      { isoCode: 'AE', nameEn: 'United Arab Emirates', nameAr: 'الإمارات العربية المتحدة', defaultCurrencyCode: 'AED', isSupported: true },
      { isoCode: 'SA', nameEn: 'Saudi Arabia', nameAr: 'المملكة العربية السعودية', defaultCurrencyCode: 'SAR', isSupported: true },
    ],
    skipDuplicates: true,
  });

  // --- System default categories (user_id = null) ---
  const systemCategories = [
    { nameEn: 'Food & Dining', nameAr: 'طعام ومطاعم', icon: 'utensils', color: '#1FAE7A' },
    { nameEn: 'Transport', nameAr: 'مواصلات', icon: 'car', color: '#E8A94C' },
    { nameEn: 'Bills & Utilities', nameAr: 'فواتير ومرافق', icon: 'file-text', color: '#4C9FE8' },
    { nameEn: 'Shopping', nameAr: 'تسوق', icon: 'shopping-bag', color: '#8C7AE6' },
    { nameEn: 'Health', nameAr: 'صحة', icon: 'heart', color: '#F2685C' },
    { nameEn: 'Entertainment', nameAr: 'ترفيه', icon: 'film', color: '#C9A876' },
    { nameEn: 'Transfers', nameAr: 'تحويلات', icon: 'send', color: '#2FB8B0' },
    { nameEn: 'Salary & Income', nameAr: 'راتب ودخل', icon: 'dollar-sign', color: '#1FAE7A' },
    { nameEn: 'Other', nameAr: 'أخرى', icon: 'more-horizontal', color: '#8892A0' },
  ];

  for (const category of systemCategories) {
    const existing = await prisma.category.findFirst({
      where: { nameEn: category.nameEn, userId: null },
    });
    if (!existing) {
      await prisma.category.create({
        data: { ...category, isSystem: true, userId: null },
      });
    }
  }

  console.log('Seed complete: currencies, countries, and system categories loaded.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
