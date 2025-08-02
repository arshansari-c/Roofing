import express from 'express'
import { login,  Profile, register } from '../controllers/auth.controller.js'
import { CheckAuth } from '../middlewares/CheckAuth.js'
import { EditSupplierDetails, fetchSupplierList, SupplierDetails } from '../controllers/supplier.controller.js'
import { EditFreelancerDetails, fetchFreelancerList, fetchOtherFreelancerDetails, fetchOtherUserDetails, FreelancerDetails } from '../controllers/freelancer.controller.js'
import { approveOrder, cancelOrder, ConversetionChat, fetchChatUser, fetchclientDetails, fetchConversationChat, fetchOrders, fetchSelectedOrderDetails, fetchUserSendOrderList, rejectOrder, SaveUserPdf, SendOrderToContractor } from '../controllers/conversation.controller.js'

export const AuthRouter = express.Router()

AuthRouter.post('/register',register)
AuthRouter.post('/login',login)
AuthRouter.post('/profile/:token', Profile)
AuthRouter.post('/supplierdetails/:token',SupplierDetails)
AuthRouter.post('/supplierdetailsedit',CheckAuth,EditSupplierDetails)
AuthRouter.post('/freelancerdetails/:token',FreelancerDetails)
AuthRouter.post('/freelancerdetailedit',CheckAuth,EditFreelancerDetails)
AuthRouter.get('/fetchfreelancerlist/:token',fetchFreelancerList)
AuthRouter.get("/fetchdetails/:seconduser",fetchOtherUserDetails)
AuthRouter.get('/fetchsupplierlist/:token',fetchSupplierList)
AuthRouter.get('/fetchfreelancerdetail/:seconduser',fetchOtherFreelancerDetails)
AuthRouter.post('/sendorder/:token/:contractorId',SendOrderToContractor)
AuthRouter.get('/cancelorder/:token/:orderId',cancelOrder)
AuthRouter.get('/fetchorder/:token',fetchOrders)
AuthRouter.get('/fetchselectedorder/:orderId',fetchSelectedOrderDetails)
AuthRouter.post('/conversationchat/:id/:clientId',ConversetionChat)
AuthRouter.get('/fetchconversationchat/:id/:clientId',fetchConversationChat)
AuthRouter.get('/fetchclientdetails/:clientId',fetchclientDetails)
AuthRouter.get('/approvedorder/:token/:orderId',approveOrder)
AuthRouter.get('/rejectorder/:token/:orderId',rejectOrder)
AuthRouter.get('/fetchuserorder/:token',fetchUserSendOrderList)
AuthRouter.get('/fetchchats/:token',fetchChatUser)
AuthRouter.post('/uploadpdf/:token',SaveUserPdf)
