import NextErrorComponent, { type ErrorProps } from 'next/error';
import type { NextPageContext } from 'next';
import type { ReactElement } from 'react';

type RuntimeErrorPage = ((props: ErrorProps) => ReactElement) & {
  getInitialProps?: (context: NextPageContext) => Promise<ErrorProps> | ErrorProps;
};

const ErrorPage: RuntimeErrorPage = (props) => <NextErrorComponent {...props} />;

ErrorPage.getInitialProps = async (context: NextPageContext) => {
  return NextErrorComponent.getInitialProps(context);
};

export default ErrorPage;
