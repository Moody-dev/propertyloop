import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  id: string;
  email: string;
  name: string;
  role: 'BUYER' | 'AGENT' | 'VENDOR';
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
