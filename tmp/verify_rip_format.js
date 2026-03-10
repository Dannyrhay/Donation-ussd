const config = {
    hubtelRecurring: { intervals: { weekly: 'WEEKLY' } },
    recurringDefaults: { startTime: '10:00', currency: 'GHS', paymentOption: 'MobileMoney' },
    orgName: 'Jesus Mission Fund'
};

function calculateEndDate(frequency) {
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 1);
    return endDate.toISOString().replace('Z', '');
}

function testPayload() {
    const frequency = 'weekly';
    const orderDate = new Date('2026-03-10T23:00:00.000Z').toISOString().replace('T', ' ').split('.')[0];
    const invoiceEndDate = new Date(calculateEndDate(frequency)).toISOString().replace('T', ' ').split('.')[0];

    const requestBody = {
        OrderDate: orderDate,
        InvoiceEndDate: invoiceEndDate,
        Description: `Weekly donation to ${config.orgName}`,
        StartTime: config.recurringDefaults.startTime,
        PaymentInterval: config.hubtelRecurring.intervals[frequency],
        CustomerMobileNumber: '233244123456',
        PaymentOption: config.recurringDefaults.paymentOption,
        Channel: 'mtn_gh_rec',
        CustomerName: 'Donor',
        RecurringAmount: 10,
        TotalAmount: 10,
        InitialAmount: 10,
        Currency: config.recurringDefaults.currency
    };

    console.log('Sample Payload:', JSON.stringify(requestBody, null, 2));

    const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    console.log('OrderDate valid:', dateRegex.test(requestBody.OrderDate));
    console.log('InvoiceEndDate valid:', dateRegex.test(requestBody.InvoiceEndDate));
}

testPayload();
