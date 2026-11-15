import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationsController } from './invitations.controller';
import { MembersService } from './members.service';
import { OrganizationsController } from './organizations.controller';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController, InvitationsController],
  providers: [MembersService],
})
export class OrganizationsModule {}
