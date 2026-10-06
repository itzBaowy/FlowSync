import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [AIController],
  providers: [AIService],
})
export class AIModule {}
