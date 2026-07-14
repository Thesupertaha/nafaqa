import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiExtractionValidatorService } from './ai-extraction-validator.service';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [TransactionsModule],
  controllers: [AiController],
  providers: [AiService, AiExtractionValidatorService],
})
export class AiModule {}
