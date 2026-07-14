import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OwnershipGuard, CheckOwnership } from '../common/guards/ownership.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

@UseGuards(JwtAuthGuard)
@Controller({ path: 'budgets', version: '1' })
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBudgetDto) {
    return this.budgetsService.create(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.budgetsService.findAllForUser(user.userId);
  }

  @UseGuards(OwnershipGuard)
  @CheckOwnership('budget')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.budgetsService.findOne(user.userId, id);
  }

  @UseGuards(OwnershipGuard)
  @CheckOwnership('budget')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgetsService.update(user.userId, id, dto);
  }

  @UseGuards(OwnershipGuard)
  @CheckOwnership('budget')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.budgetsService.remove(user.userId, id);
  }
}
