import { Mailable } from '@tylix/mail';

export interface ProductAlert {
    subject: string;
    headline: string;
    product: string;
    detail: string;
    when: string;
    statusUrl: string;
}

export class ProductAlertMail extends Mailable {
    constructor(private alert: ProductAlert) {
        super();
    }

    build() {
        const { subject, ...data } = this.alert;
        return {
            subject,
            view: 'product-alert',
            data,
        };
    }
}